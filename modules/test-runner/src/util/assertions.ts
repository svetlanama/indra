import { waffleChai } from "@ethereum-waffle/chai";
import { use } from "chai";

use(require("chai-as-promised"));
use(waffleChai);

export { expect } from "chai";
