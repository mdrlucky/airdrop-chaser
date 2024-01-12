import { HardhatRuntimeEnvironment, HttpNetworkConfig } from "hardhat/types"
import DexArgument from "../interface/dex.argument.interface"
import { configs, PoolType, TokenConfig, Token } from "../utils/helper-config"
import axios from "axios"
import { AddressLike, ethers } from "ethers"
import { SyncSwapRouterABI } from "../utils/sync-swap-abi"

export async function interactWithDex(taskArgs: DexArgument, hre: HardhatRuntimeEnvironment) {
    try {
        console.log(taskArgs)
        const networksList = Object.keys(hre.config.networks)
        console.log("List of networks:", networksList)

        for (const networkName of networksList) {
            const networkConfig = hre.config.networks[networkName]

            if (!isHttpNetworkConfig(networkConfig)) {
                console.log(`Skipping network ${networkName} (no URL specified)`)
                continue
            }

            const { provider, network, signers } = await connectToNetwork(networkConfig, hre)

            console.log(`Connected to network: ${networkName} (ID: ${network.chainId})`)

            await processBalances(network, provider, signers, taskArgs, hre)
        }
    } catch (error) {
        console.error("Error connecting to the RPC server:", error)
    }
}

async function connectToNetwork(networkConfig: HttpNetworkConfig, hre: HardhatRuntimeEnvironment) {
    const provider = new hre.ethers.JsonRpcProvider(networkConfig.url)
    const network = await provider.getNetwork()
    console.log(`*************** Network ${network.name} and Chain Id ${network.chainId} ********************`)
    const signers = await hre.ethers.getSigners()
    return { provider, network, signers }
}

async function processBalances(
    network: ethers.Network,
    provider: ethers.JsonRpcProvider,
    signers: ethers.Signer[],
    taskArgs: DexArgument,
    hre: HardhatRuntimeEnvironment
) {
    for (let i = 0; i < signers.length; i++) {
        const address = await signers[i].getAddress()
        const balance = await provider.getBalance(address)

        console.log(
            `Balance of ${address} on ${network.name} ${network.chainId}: ${hre.ethers.formatEther(balance)} ETH`
        )

        if (balance > 0) {
            await handleDexInteraction(network, provider, signers[i], address, taskArgs)
        } else {
            console.log(`This account ${address} doesn't have enough ETH balance!`)
        }
    }
}

async function handleDexInteraction(
    network: ethers.Network,
    provider: ethers.JsonRpcProvider,
    signer: ethers.Signer,
    taskArgs: DexArgument
) {
    if (taskArgs.dexName !== "SyncSwap") {
        console.log(`This dex is not supported under this network ${network.chainId}`)
        return
    }

    if (!areValidTokens(taskArgs.initialCoin, taskArgs.endCoin)) {
        console.log(`In SyncSwap we don't configure this keyPair ${taskArgs.initialCoin}/${taskArgs.endCoin}`)
        return
    }

    if (taskArgs.initialCoin.toUpperCase() === "ETH" || taskArgs.endCoin.toUpperCase() === "ETH") {
        await executeSwapCoin(
            network,
            provider,
            signer,
            taskArgs.initialCoin.toUpperCase(),
            taskArgs.endCoin.toUpperCase()
        )
    } else {
        console.log("KeyPair Without ETH is not supported yet")
    }
}

function areValidTokens(initialCoin: string, endCoin: string): boolean {
    return (
        Object.values(Token).includes(initialCoin.toUpperCase() as Token) &&
        Object.values(Token).includes(endCoin.toUpperCase() as Token)
    )
}

async function executeSwapCoin(
    network: ethers.Network,
    provider: ethers.JsonRpcProvider,
    signer: ethers.Signer,
    initialCoin: string,
    endCoin: string
) {
    const accountAddress = await signer.getAddress()
    const swapParamsInitialCoin = configs[network.chainId.toString()]!.SyncSwap[initialCoin] as TokenConfig
    const swapParamsEndCoin = configs[network.chainId.toString()]!.SyncSwap[endCoin] as TokenConfig
    if (swapParamsInitialCoin && swapParamsEndCoin) {
        // Get amount out value
        const amountIn = parseFloat(swapParamsInitialCoin.amount)

        let amountOut = await getToken2AmountFromToken1(
            configs[network.chainId.toString()]!.SyncSwap!.networkName,
            configs[network.chainId.toString()]!.SyncSwap!.poolAddress,
            amountIn,
            swapParamsInitialCoin.decimals,
            swapParamsEndCoin.decimals,
            swapParamsInitialCoin.address
        )
        if (amountOut > 0) {
            if (initialCoin.toUpperCase() !== "ETH") {
                //Approve token
                const erc20Contract = new ethers.Contract(
                    swapParamsInitialCoin.address,
                    [
                        "function approve(address, uint256) returns (bool)",
                        "function allowance(address, address) view returns (uint256)",
                        "function balanceOf(address) view returns (uint256)",
                    ],
                    provider
                )
                const balanceOfCoin = await erc20Contract.balanceOf(accountAddress)
                const convertedAmount = parseFloat(swapParamsInitialCoin.amount) * 10 ** swapParamsInitialCoin.decimals
                const bigIntAmount = BigInt(Math.floor(convertedAmount))
                if (balanceOfCoin >= bigIntAmount) {
                    const allowance = await erc20Contract.allowance(
                        accountAddress,
                        configs[network.chainId.toString()]!.SyncSwap!.routerAddress
                    )
                    if (allowance < bigIntAmount) {
                        const approveTx = await erc20Contract
                            .connect(signer)
                            .approve(configs[network.chainId.toString()]!.SyncSwap!.routerAddress, bigIntAmount)
                        const approveTxReceipt = await approveTx.wait(2)
                        if (approveTxReceipt.status == "1") {
                            console.log("Approve Transaction Executed successfully " + approveTxReceipt.hash)
                            // Swap
                            await swapCoin(
                                network,
                                provider,
                                swapParamsInitialCoin,
                                swapParamsEndCoin,
                                signer,
                                accountAddress,
                                amountIn,
                                amountOut,
                                initialCoin
                            )
                        } else {
                            console.log("Approve Transaction Failed " + approveTxReceipt.hash)
                        }
                    } else {
                        // Swap
                        await swapCoin(
                            network,
                            provider,
                            swapParamsInitialCoin,
                            swapParamsEndCoin,
                            signer,
                            accountAddress,
                            amountIn,
                            amountOut,
                            initialCoin
                        )
                    }
                } else {
                    console.log("Not enough balance of " + initialCoin)
                }
            } else {
                // Swap
                await swapCoin(
                    network,
                    provider,
                    swapParamsInitialCoin,
                    swapParamsEndCoin,
                    signer,
                    accountAddress,
                    amountIn,
                    amountOut,
                    initialCoin
                )
            }
        } else {
            console.log("The amount to swap is not correct!")
        }
    } else {
        console.log("This coin is not supported!")
    }
}

async function swapCoin(
    network: ethers.Network,
    provider: ethers.JsonRpcApiProvider,
    swapParamsInitialCoin: TokenConfig,
    swapParamsEndCoin: TokenConfig,
    signer: ethers.Signer,
    accountAddress: string,
    amountIn: number,
    amountOut: number,
    initialCoin: string
) {
    const routerContract = new ethers.Contract(
        configs[network.chainId.toString()]!.SyncSwap!.routerAddress,
        SyncSwapRouterABI,
        provider
    )
    const currentTimestamp = Math.floor(Date.now() / 1000)
    const fiveMinutesLater = currentTimestamp + 5 * 60
    swapParamsEndCoin.paths[0].steps[0].data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint8"],
        [swapParamsInitialCoin.address, accountAddress, swapParamsEndCoin.withdrawIndex]
    )
    if (initialCoin !== "ETH") {
        swapParamsEndCoin.paths[0].steps[0].pool = swapParamsInitialCoin.paths[0].steps[0].pool
        swapParamsEndCoin.paths[0].tokenIn = swapParamsInitialCoin.address
    }
    if (swapParamsEndCoin)
        swapParamsEndCoin.paths[0].amountIn = (amountIn * Math.pow(10, swapParamsInitialCoin.decimals)).toString()
    let tx
    if (initialCoin == "ETH") {
        tx = await routerContract
            .connect(signer)
            .swap(swapParamsEndCoin.paths, ethers.toBigInt(amountOut), ethers.toBigInt(fiveMinutesLater), {
                value: swapParamsEndCoin.paths[0].amountIn,
            })
    } else {
        tx = await routerContract
            .connect(signer)
            .swap(swapParamsEndCoin.paths, ethers.toBigInt(amountOut), ethers.toBigInt(fiveMinutesLater))
    }
    const txReceipt = await tx.wait()
    if (txReceipt.status == "1") {
        console.log("Transaction Executed successfully " + txReceipt.hash)
    } else {
        console.log("Transaction Failed " + txReceipt.hash)
    }
}

async function getToken2AmountFromToken1(
    networkName: string,
    pollAddress: string,
    token1Amount: number,
    token1Decimals: number,
    token2Decimals: number,
    token1Address: string
) {
    try {
        const apiUrl = "https://api.geckoterminal.com/api/v2/networks/" + networkName + "/pools/" + pollAddress

        const response = await axios.get(apiUrl)
        let responseData: PoolType = response.data.data
        const quoteTokenPriceBaseToken = responseData.attributes.quote_token_price_base_token
        // Determine who is the base and the quote of this pool
        let baseDecimals = token2Decimals
        let quoteDecimals = token1Decimals
        let amountIn = token1Amount
        if (responseData.relationships.base_token.data.id == networkName + "_" + token1Address) {
            baseDecimals = token1Decimals
            quoteDecimals = token2Decimals
            // Adjust the conversion based on the decimal scales
            const quantityInQuote =
                (amountIn * 10 ** quoteDecimals) / (parseFloat(quoteTokenPriceBaseToken) * 10 ** baseDecimals)
            // Slippage of 5%
            return Math.floor(quantityInQuote * 10 ** baseDecimals * (1 - 0.05))
        } else {
            // Adjust the conversion based on the decimal scales
            const quantityInBase =
                (amountIn * parseFloat(quoteTokenPriceBaseToken)) / 10 ** (quoteDecimals - baseDecimals)
            // Slippage of 5%
            return Math.floor(quantityInBase * 10 ** quoteDecimals * (1 - 0.05))
        }
    } catch (error) {
        // Handle errors
        console.error("Error fetching data:", error)
    }
    return 0
}

function isHttpNetworkConfig(config: any): config is HttpNetworkConfig {
    return (
        config &&
        typeof config.url === "string" &&
        !config.url.includes("127.0.0.1") &&
        !config.url.includes("eth-mainnet.")
    )
}

module.exports = { interactWithDex }
