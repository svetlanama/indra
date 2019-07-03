import { Grid, Typography, withStyles } from "@material-ui/core";
import React, { Component } from "react";

import { getChainBalance } from "../utils";

const styles = theme => ({
  row: {
    color: "white"
  },
  pending: {
    marginBottom: "3%",
    color: "white"
  },
  clipboard: {
    cursor: "pointer"
  }
});

class ChannelCard extends Component {
  render() {
    const { classes } = this.props;
    // only displays token value by default
    const balance = getChainBalance().token
    const whole = balance.substring(0, balance.indexOf('.'))
    const part = balance.substring(balance.indexOf('.'))
    return (
        <Grid>
          <Grid 
            container
            spacing={8}
            direction="row"
            style={{
              paddingLeft: "10%",
              paddingRight: "10%",
              paddingTop: "10%",
              paddingBottom: "20%",
              backgroundColor: "#282b2e",
              textAlign: "center"
            }}
            alignItems="center"
            justify="center"
          >
          <Grid item xs={12}>
            <span>
              <Typography inline={"true"} variant="h5" className={classes.row}>
                {"$ "}
              </Typography>
              <Typography inline={"true"} variant="h1" className={classes.row}>
                <span>{whole}</span>
              </Typography>
              <Typography inline={"true"} variant="h3" className={classes.row}>
                <span>{part}</span>
              </Typography>
            </span>
          </Grid>
        </Grid>
      </Grid>
    );
  }
}

export default withStyles(styles)(ChannelCard);