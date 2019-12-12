import { IMessagingService, MessagingServiceFactory } from "@connext/messaging";
import { CF_PATH } from "@connext/types";
import "core-js/stable";
import { Contract, providers, utils } from "ethers";
import { AddressZero } from "ethers/constants";
import { fromExtendedKey, fromMnemonic } from "ethers/utils/hdnode";
import tokenAbi from "human-standard-token-abi";
import "regenerator-runtime/runtime";

import { ChannelProvider, createCFChannelProvider } from "./channelProvider";
import { ConnextClient } from "./connext";
import { Logger, stringify } from "./lib";
import { NodeApiClient } from "./node";
import {
  CFCoreTypes,
  ClientOptions,
  ConnextClientStorePrefix,
  CreateChannelMessage,
  GetConfigResponse,
  IConnextClient,
  Store,
} from "./types";

interface EthProviderSetup {
  ethProvider: providers.JsonRpcProvider;
  network: utils.Network;
}

export const setupEthProvider = async (ethProviderUrl: string): Promise<EthProviderSetup> => {
  const ethProvider = new providers.JsonRpcProvider(ethProviderUrl);
  const network = await ethProvider.getNetwork();

  // special case for ganache
  if (network.chainId === 4447) {
    network.name = "ganache";
    // Enforce using provided signer, not via RPC
    ethProvider.getSigner = (addressOrIndex?: string | number): any => {
      throw { code: "UNSUPPORTED_OPERATION" };
    };
  }

  return { ethProvider, network };
};

export const createMessagingService = async (
  nodeUrl: string,
  logLevel: number,
): Promise<IMessagingService> => {
  const messagingFactory = new MessagingServiceFactory({
    logLevel,
    messagingUrl: nodeUrl,
  });
  const messaging = messagingFactory.createService("messaging");
  await messaging.connect();
  return messaging;
};

interface ServiceSetup {
  messaging: IMessagingService;
  node: NodeApiClient;
  config: GetConfigResponse;
}

export const setupServices = async (
  nodeUrl: string,
  log: Logger,
  logLevel: number,
): Promise<ServiceSetup> => {
  // create a messaging service client
  log.debug(`Creating messaging service client (logLevel: ${logLevel})`);
  const messaging = await createMessagingService(nodeUrl, logLevel);

  // create a new node api instance
  const node = new NodeApiClient({ logLevel, messaging });
  const config = await node.config();
  log.debug(`Node provided config: ${stringify(config)}`);
  return { messaging, node, config };
};

type KeyGen = (index: string) => Promise<string>;

interface ChannelProviderOptions {
  keyGen?: KeyGen;
  mnemonic?: string;
  nodeUrl?: string;
  store?: Store;
  xpub?: string;
}

interface ChannelProviderSetup {
  node: NodeApiClient;
  messaging: IMessagingService;
  channelProvider: ChannelProvider;
  config: GetConfigResponse;
  keyGen: KeyGen;
  store: Store;
}

export const setupChannelProvider = async (
  ethProvider: providers.JsonRpcProvider,
  log: Logger,
  logLevel: number,
  providedChannelProvider?: ChannelProvider,
  channelProviderOptions?: ChannelProviderOptions,
): Promise<ChannelProviderSetup> => {
  // spread channelProviderOptions
  const { store, mnemonic } = channelProviderOptions;
  let { nodeUrl, xpub, keyGen } = channelProviderOptions;

  // setup messaging and node api
  let messaging: IMessagingService;
  let node: NodeApiClient;
  let config: GetConfigResponse;

  // setup channelProvider
  let channelProvider: ChannelProvider;

  if (providedChannelProvider) {
    channelProvider = providedChannelProvider;
    if (!channelProvider.config || !Object.keys(channelProvider.config)) {
      await channelProvider.enable();
    }
    log.debug(`Using provided channelProvider config: ${stringify(channelProvider.config)}`);
    nodeUrl = channelProvider.config.nodeUrl;

    const services = await setupServices(nodeUrl, log, logLevel);

    messaging = services.messaging;
    node = services.node;
    config = services.config;
  } else if (mnemonic || (xpub && keyGen)) {
    if (!store) {
      throw new Error("Client must be instantiated with store if not using a channelProvider");
    }
    if (mnemonic) {
      // Convert mnemonic into xpub + keyGen if provided
      const hdNode = fromExtendedKey(fromMnemonic(mnemonic).extendedKey).derivePath(CF_PATH);
      xpub = hdNode.neuter().extendedKey;
      keyGen = (index: string): Promise<string> =>
        Promise.resolve(hdNode.derivePath(index).privateKey);
    }

    const services = await setupServices(nodeUrl, log, logLevel);

    messaging = services.messaging;
    node = services.node;
    config = services.config;

    const cfChannelProviderOptions = {
      ethProvider,
      keyGen,
      lockService: { acquireLock: node.acquireLock.bind(node) },
      messaging: messaging as any,
      networkContext: config.contractAddresses,
      nodeConfig: { STORE_KEY_PREFIX: ConnextClientStorePrefix },
      nodeUrl,
      store,
      xpub,
    };
    log.debug(`Creating CFChannelProvider with options: ${stringify(cfChannelProviderOptions)}`);
    channelProvider = await createCFChannelProvider(cfChannelProviderOptions);
  } else {
    throw new Error(
      // tslint:disable-next-line:max-line-length
      `Client must be instantiated with xpub and keyGen, or a channelProvider if not using mnemonic`,
    );
  }

  log.debug(`Using channelProvider config: ${stringify(channelProvider.config)}`);

  // set pubids + channelProvider
  node.channelProvider = channelProvider;
  node.userPublicIdentifier = channelProvider.config.userPublicIdentifier;
  node.nodePublicIdentifier = config.nodePublicIdentifier;
  return { node, messaging, channelProvider, config, keyGen, store };
};

export const setupMultisigAddress = async (
  node: NodeApiClient,
  channelProvider: ChannelProvider,
  log: Logger,
): Promise<ChannelProvider> => {
  const myChannel = await node.getChannel();
  let multisigAddress: string;
  if (!myChannel) {
    log.debug("no channel detected, creating channel..");
    const creationEventData: CFCoreTypes.CreateChannelResult = await new Promise(
      async (res: any, rej: any): Promise<any> => {
        const timer = setTimeout(
          (): void => rej("Create channel event not fired within 30s"),
          30000,
        );
        channelProvider.once(
          CFCoreTypes.EventNames.CREATE_CHANNEL_EVENT as CFCoreTypes.EventName,
          (data: CreateChannelMessage): void => {
            clearTimeout(timer);
            res(data.data);
          },
        );

        const creationData = await node.createChannel();
        log.debug(`created channel, transaction: ${stringify(creationData)}`);
      },
    );
    multisigAddress = creationEventData.multisigAddress;
  } else {
    multisigAddress = myChannel.multisigAddress;
  }
  log.debug(`multisigAddress: ${multisigAddress}`);

  channelProvider.multisigAddress = multisigAddress;
  return channelProvider;
};

export const connect = async (opts: ClientOptions): Promise<IConnextClient> => {
  const { logLevel, ethProviderUrl } = opts;
  const log = new Logger("ConnextConnect", logLevel);

  // setup ethProvider + network information
  const { ethProvider, network } = await setupEthProvider(ethProviderUrl);

  // setup channelProvider + node + messaging
  const { node, messaging, channelProvider, config, keyGen, store } = await setupChannelProvider(
    ethProvider,
    log,
    logLevel,
    opts.channelProvider,
    {
      keyGen: opts.keyGen,
      mnemonic: opts.mnemonic,
      nodeUrl: opts.nodeUrl,
      store: opts.store,
      xpub: opts.xpub,
    },
  );

  // setup multisigAddress + assign to channelProvider
  await setupMultisigAddress(node, channelProvider, log);

  // create a token contract based on the provided token
  const token = new Contract(config.contractAddresses.Token, tokenAbi, ethProvider);

  // create appRegistry
  const appRegistry = await node.appRegistry();

  // create the new client
  const client = new ConnextClient({
    appRegistry,
    channelProvider,
    config,
    ethProvider,
    keyGen,
    messaging,
    network,
    node,
    store,
    token,
    ...opts, // use any provided opts by default
  });

  try {
    await client.getFreeBalance();
  } catch (e) {
    if (e.message.includes(`StateChannel does not exist yet`)) {
      log.debug(`Restoring client state: ${e}`);
      await client.restoreState();
    } else {
      throw e;
    }
  }

  log.debug("Registering subscriptions");
  await client.registerSubscriptions();

  // check if there is a coin refund app installed for eth and tokens
  await client.uninstallCoinBalanceIfNeeded(AddressZero);
  await client.uninstallCoinBalanceIfNeeded(config.contractAddresses.Token);

  // make sure there is not an active withdrawal with >= MAX_WITHDRAWAL_RETRIES
  log.debug("Resubmitting active withdrawals");
  await client.resubmitActiveWithdrawal();

  // wait for wd verification to reclaim any pending async transfers
  // since if the hub never submits you should not continue interacting
  log.debug("Reclaiming pending async transfers");
  // NOTE: Removing the following await results in a subtle race condition during bot tests.
  //       Don't remove this await again unless you really know what you're doing & bot tests pass
  // no need to await this if it needs collateral
  // TODO: without await causes race conditions in bot, refactor to
  // use events
  await client.reclaimPendingAsyncTransfers();

  log.debug("Done creating channel client");
  return client;
};
