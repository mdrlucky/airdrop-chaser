import { HardhatUserConfig, task } from "hardhat/config"
import "@nomicfoundation/hardhat-toolbox"
import "@matterlabs/hardhat-zksync-deploy"
import "@matterlabs/hardhat-zksync-solc"
import { interactWithDex } from "./tasks/interactWithDex"
import * as dotenv from "dotenv"
dotenv.config({ path: __dirname + "/.env" })

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL || ""
const PRIVATE_KEYS = process.env.PRIVATE_KEYS?.split(" ") || []

task("interact-with-dex", "A task to interact with dex")
    .addPositionalParam("dexName")
    .addPositionalParam("initialCoin")
    .addPositionalParam("endCoin")
    .setAction(async (taskArgs, hre) => {
        await interactWithDex(taskArgs, hre)
    })

const config: HardhatUserConfig = {
    solidity: "0.8.19",
    networks: {
        mainnet: {
            url: MAINNET_RPC_URL,
            accounts: PRIVATE_KEYS,
            zksync: false,
        },
        zkSync: {
            url: "https://mainnet.era.zksync.io",
            ethNetwork: "mainnet",
            accounts: PRIVATE_KEYS,
            zksync: true,
        },
        scroll: {
            url: "https://rpc.scroll.io/",
            accounts: PRIVATE_KEYS,
        },
    },
}

export default config
