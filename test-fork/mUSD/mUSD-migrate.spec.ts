/* eslint-disable no-underscore-dangle */
/* eslint-disable no-param-reassign */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-console */
import { expect } from "chai"
import { Contract, ContractFactory, Signer } from "ethers"
import { ethers, network } from "hardhat"

import { DEAD_ADDRESS, ONE_DAY, ONE_WEEK } from "@utils/constants"
import { applyDecimals, applyRatioMassetToBasset, BN, simpleToExactAmount } from "@utils/math"
import {
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    ERC20__factory,
    Masset,
    MusdV3,
    MusdV3__factory,
    MusdV3Rebalance4Pool__factory,
    MusdV3Rebalance4Pool,
} from "types/generated"
import { MusdV3LibraryAddresses } from "types/generated/factories/MusdV3__factory"
import { increaseTime } from "@utils/time"
import { BassetStatus } from "@utils/mstable-objects"

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { formatUnits } from "ethers/lib/utils"

import { abi as MusdV2Abi, bytecode as MusdV2Bytecode } from "./MassetV2.json"
import { abi as BasketManagerV2Abi, bytecode as BasketManagerV2Bytecode } from "./BasketManagerV2.json"
import { abi as SavingsManagerAbi, bytecode as SavingsManagerBytecode } from "./SavingsManager.json"

// Accounts that are impersonated
const deployerAddress = "0x19F12C947D25Ff8a3b748829D8001cA09a28D46d"
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const mUsdWhaleAddress = "0x6595732468A241312bc307F327bA0D64F02b3c20"

// Mainnet contract addresses
const validatorAddress = "0xCa480D596e6717C95a62a4DC1bD4fbD7b7E7d705"
const mUsdV3Address = "0x15B2838Cd28cc353Afbe59385db3F366D8945AEe"
const mUsdProxyAddress = "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5"
const basketManagerAddress = "0x66126B4aA2a1C07536Ef8E5e8bD4EfDA1FdEA96D"
const nexusAddress = "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3"
const delayedProxyAdminAddress = "0x5C8eb57b44C1c6391fC7a8A0cf44d26896f92386"
const governorAddress = "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2"

const forkBlockNumber = 12043106

const defaultConfig = {
    a: 135,
    limits: {
        min: simpleToExactAmount(5, 16),
        max: simpleToExactAmount(65, 16),
    },
}

const ethUsd = 1800
const gasPriceGwei = 150 // Gwei is 10^9

interface Token {
    index?: number
    symbol: string
    address: string
    integrator: string
    decimals: number
    vaultBalance: BN
    whaleAddress: string
}

const sUSD: Token = {
    symbol: "sUSD",
    address: "0x57Ab1ec28D129707052df4dF418D58a2D46d5f51",
    integrator: "0xf617346A0FB6320e9E578E0C9B2A4588283D9d39", // Aave vault
    decimals: 18,
    vaultBalance: BN.from("80910135777356730215"),
    whaleAddress: "0x8cA24021E3Ee3B5c241BBfcee0712554D7Dc38a1",
}
const USDC: Token = {
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    integrator: "0xD55684f4369040C12262949Ff78299f2BC9dB735", // Compound Vault
    decimals: 6,
    vaultBalance: BN.from("190649757940"),
    whaleAddress: "0xF977814e90dA44bFA03b6295A0616a897441aceC", // Binance
}
const TUSD: Token = {
    symbol: "TUSD",
    address: "0x0000000000085d4780B73119b644AE5ecd22b376",
    integrator: "0xf617346A0FB6320e9E578E0C9B2A4588283D9d39", // Aave vault
    decimals: 18,
    vaultBalance: BN.from("20372453144590237158484978"),
    whaleAddress: "0xF977814e90dA44bFA03b6295A0616a897441aceC", // Binance
}
const USDT: Token = {
    symbol: "USDT",
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    integrator: "0xf617346A0FB6320e9E578E0C9B2A4588283D9d39", // Aave vault
    decimals: 6,
    vaultBalance: BN.from("24761709994543"),
    whaleAddress: "0xF977814e90dA44bFA03b6295A0616a897441aceC", // Binance
}
const DAI: Token = {
    symbol: "DAI",
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    integrator: "0xD55684f4369040C12262949Ff78299f2BC9dB735", // Compound Vault
    decimals: 18,
    vaultBalance: BN.from(0),
    whaleAddress: "0xF977814e90dA44bFA03b6295A0616a897441aceC", // Binance
}

// bAssets before changes
const currentBassets: Token[] = [
    {
        index: 0,
        ...sUSD,
    },
    {
        index: 1,
        ...USDC,
    },
    {
        index: 2,
        ...TUSD,
    },
    {
        index: 3,
        ...USDT,
    },
]

const intermediaryBassets: Token[] = [
    {
        index: 0,
        ...sUSD,
    },
    {
        index: 1,
        ...USDC,
    },
    {
        index: 2,
        ...TUSD,
    },
    {
        index: 3,
        ...USDT,
    },
    {
        index: 4,
        ...DAI,
    },
]

// ideal bAssets before upgrade
const finalBassets: Token[] = [
    {
        index: 0,
        ...sUSD,
    },
    {
        index: 1,
        ...USDC,
    },
    {
        index: 1,
        ...DAI,
    },
    {
        index: 3,
        ...USDT,
    },
]

// impersonates a specific account
const impersonate = async (addr): Promise<Signer> => {
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [addr],
    })
    return ethers.provider.getSigner(addr)
}

// impersonates all accounts
const impersonateAccounts = async () => {
    // Impersonate mainnet accounts
    const accounts = {
        deployer: await impersonate(deployerAddress),
        governor: await impersonate(governorAddress),
        ethWhale: await impersonate(ethWhaleAddress),
        mUSDWhale: await impersonate(mUsdWhaleAddress),
    }

    // send some Ether to the impersonated multisig contract as it doesn't have Ether
    await accounts.ethWhale.sendTransaction({
        to: governorAddress,
        value: simpleToExactAmount(10),
    })

    return accounts
}

interface DeployedMusdV3 {
    proxy: MusdV3
    impl: MusdV3
}

// Deploys Migrator, pulls Manager address and deploys mUSD implementation
const getMusdv3 = async (deployer: Signer): Promise<DeployedMusdV3> => {
    const linkedAddress: MusdV3LibraryAddresses = {
        __$4ff61640dcfbdf6af5752b96f9de1a9efe$__: "0xda681D409319b1f4122B1402C8B5cD4BaEDF9001", // Migrator library
        __$1a38b0db2bd175b310a9a3f8697d44eb75$__: "0x1E91F826fa8aA4fa4D3F595898AF3A64dd188848", // Masset Manager
    }

    // Point to the mUSD contract using the new V3 interface via the existing mUSD proxy
    const mUsdV3Factory = new MusdV3__factory(linkedAddress, deployer)
    const mUsdV3Proxy = mUsdV3Factory.attach(mUsdProxyAddress)

    // Deploy the new mUSD implementation
    const mUsdV3Impl = mUsdV3Factory.attach(mUsdV3Address)

    return {
        proxy: mUsdV3Proxy,
        impl: mUsdV3Impl,
    }
}

// Test mUSD token storage variables
const validateTokenStorage = async (token: MusdV3 | Masset | Contract, overrideSupply = "45324535157903774527261941") => {
    expect(await token.symbol(), "symbol").to.eq("mUSD")
    expect(await token.name(), "name").to.eq("mStable USD")
    expect(await token.decimals(), "decimals").to.eq(18)
    // some mUSD token holder
    expect(await token.balanceOf("0x5C80E54f903458edD0723e268377f5768C7869d7"), `mUSD balance at block ${forkBlockNumber}`).to.eq(
        "6971708003000000000000",
    )
    // For forked block number
    expect(await token.totalSupply(), `totalSupply at block ${forkBlockNumber}`).to.eq("46499970109431651210054546")
}

// Test the existing Masset V2 storage variables
const validateUnchangedMassetStorage = async (mUsd: MusdV3 | Masset | Contract, overrideSurplus = "358648087000000000001") => {
    expect(await mUsd.swapFee(), "swap fee").to.eq(simpleToExactAmount(6, 14))
    expect(await mUsd.redemptionFee(), "redemption fee").to.eq(simpleToExactAmount(3, 14))
    expect(await mUsd.cacheSize(), "cache size").to.eq(simpleToExactAmount(3, 16))
    expect(await mUsd.surplus(), `surplus at block ${forkBlockNumber}`).to.eq(overrideSurplus)
}

// Check that the bAsset data is what we expect
const validateBasset = (bAssets, i: number, expectToken: Token, expectVaultBalances?: BN[]) => {
    if (!expectVaultBalances) {
        expectVaultBalances = currentBassets.map((token) => token.vaultBalance)
    }
    expect(bAssets.personal[i].addr, `${expectToken.symbol} address`).to.eq(expectToken.address)
    expect(bAssets.personal[i].integrator, `${expectToken.symbol} integrator`).to.eq(expectToken.integrator)
    expect(bAssets.personal[i].hasTxFee, `${expectToken.symbol} hasTxFee`).to.be.false
    expect(bAssets.personal[i].status, `${expectToken.symbol} status`).to.eq(BassetStatus.Normal)
    expect(bAssets.data[i].ratio, `${expectToken.symbol} ratio`).to.eq(simpleToExactAmount(1, 8 + (18 - expectToken.decimals)))
    expect(bAssets.data[i].vaultBalance, `${expectToken.symbol} vault`).to.eq(expectVaultBalances[i])
}

// Test the new Masset V3 storage variables
const validateNewMassetStorage = async (mUsd: MusdV3 | Masset, validator: string, expectVaultBalances?: BN[]) => {
    expect(await mUsd.forgeValidator(), "forge validator").to.eq(validator)
    expect(await mUsd.maxBassets(), "maxBassets").to.eq(10)

    // bAsset personal data
    const bAssets = await mUsd.getBassets()
    finalBassets.forEach(async (token, i) => {
        validateBasset(bAssets, i, token, expectVaultBalances)
        expect(await mUsd.bAssetIndexes(token.address)).eq(i)
        const bAsset = await mUsd.getBasset(token.address)
        expect(bAsset[0][0]).eq(token.address)
    })

    // Get basket state
    const basketState = await mUsd.basket()
    expect(basketState.undergoingRecol, "undergoingRecol").to.be.true
    expect(basketState[0], "basketState[0]").to.be.true
    expect(basketState.failed, "undergoingRecol").to.be.false
    expect(basketState[1], "basketState[1]").to.be.false

    const invariantConfig = await mUsd.getConfig()
    expect(invariantConfig.a, "amplification coefficient (A)").to.eq(defaultConfig.a * 100)
    expect(invariantConfig.limits.min, "min limit").to.eq(defaultConfig.limits.min)
    expect(invariantConfig.limits.max, "max limit").to.eq(defaultConfig.limits.max)
}

// Swaps two tokens in an attempted rebalance
const balanceBasset = async (
    mUsdV2: Contract,
    scaledVaultBalances: BN[],
    scaledTargetBalance: BN,
    inputToken: Token,
    outputToken: Token,
): Promise<void> => {
    const { whaleAddress } = inputToken
    const signer = await impersonate(whaleAddress)
    // scaled target weight - input scaled balance
    const inputDiffToTarget = scaledTargetBalance.sub(scaledVaultBalances[inputToken.index])
    // output scaled balance - scaled target weight
    // If output is TUSD then simply set the baseline to 0
    scaledTargetBalance = outputToken.symbol === "TUSD" ? BN.from(0) : scaledTargetBalance
    const outputDiffToTarget = scaledVaultBalances[outputToken.index].sub(scaledTargetBalance)
    const minBassetAmount = inputDiffToTarget.lt(outputDiffToTarget) ? inputDiffToTarget : outputDiffToTarget
    if (minBassetAmount.lt(0)) return
    const bAssetAmount = applyRatioMassetToBasset(minBassetAmount, BN.from(10).pow(26 - inputToken.decimals))

    // Check the whale has enough input tokens
    const inputTokenContract = new ERC20__factory(signer).attach(inputToken.address)
    const whaleBalance = await inputTokenContract.balanceOf(whaleAddress)
    expect(whaleBalance, `Whale ${inputToken.symbol} balance`).to.gte(bAssetAmount)
    // whale approves input tokens
    await inputTokenContract.approve(mUsdV2.address, whaleAddress)

    const tx = mUsdV2.connect(signer).swap(inputToken.address, outputToken.address, bAssetAmount, whaleAddress)

    await expect(tx).to.emit(mUsdV2, "Swapped")
    // TODO - consider what this is used for and whether to rely on cached settings
    scaledVaultBalances[inputToken.index] = scaledVaultBalances[inputToken.index].add(minBassetAmount)
    // this is not 100% accurate as the outputs are less fees but it's close enough for testing
    scaledVaultBalances[outputToken.index] = scaledVaultBalances[outputToken.index].sub(minBassetAmount)
}

/**
 * TESTING mUSD Upgrade
 * ------------------------------
 * Step 1: Deploy contract and propose upgrade to begin the 1 week countdown
 *           1. Deploy Migrator, Manager & InvariantValidator
 *           2. Deploy mUSD & propose upgrade with initialization data
 * Test 1: i) Deployed mUSDV3 contract has been proposed correctly
 *
 * ~~ Wait 6 days ~~
 *
 * Step 2: Achieve equilibrium weights & prep
 *           1. Add DAI to CompoundIntegration
 *           2. Add DAI to the basket
 *           3. Set max weights
 *           4. Collect interest
 *           5. Achieve equilibrium weights
 *             - Ensure it cannot be broken
 *           6. Pause BasketManager & SavingsManager
 *           7. Remove TUSD from basket
 * Test 2: i) Existing storage in BasketManager checks out
 *         ii) State at 2.3
 *         iii) Mostly on 2.4 execution
 *         iv) Final state pre-upgrade (everything in place & paused)
 *
 * Step 3: Upgrade mUSD
 *           1. Accept governance proposal
 *           2. Verify storage & paused
 *           3. Unpause system
 * Test 3: i) Upgrade works as intended
 *         ii) All storage has been added & system is paused
 *         iii) Post-unpause: ensure mint, swap, redeem all work as expected
 *         iv) Collect interest & platform interest work
 *         v) Do some admin operations
 *
 * Data
 * ------------------------------
 * mUSD proxy address: 0xe2f2a5C287993345a840Db3B0845fbC70f5935a5
 * Current implementation: 0xe0d0d052d5b1082e52c6b8422acd23415c3df1c4 & https://github.com/mstable/mStable-contracts/blob/6d935eb8c8797e240a7e9fde7603c90d730608ce/contracts/masset/Masset.sol
 * New implementation: ../../contracts/masset/mUSD/MusdV3.sol
 * Contract diff vs current implementation: https://www.diffchecker.com/QqxVbKxb
 * Contract diff vs Masset.sol: https://www.diffchecker.com/jwpfAgVK
 */
describe("mUSD V2.0 to V3.0", () => {
    let accounts: {
        deployer: Signer
        governor: Signer
        ethWhale: Signer
        mUSDWhale: Signer
    }
    let savingsManager: Contract
    let mUsdV2Factory: ContractFactory
    let mUsdV2: Contract
    let mUsdV3: DeployedMusdV3
    let delayedProxyAdmin: DelayedProxyAdmin
    let deployer: Signer
    let governor: Signer
    const balancedVaultBalances: BN[] = []
    before("Set-up globals", async () => {
        accounts = await impersonateAccounts()
        deployer = accounts.deployer
        governor = accounts.governor

        // Point to mUSD contract using the old V2 interface via the proxy
        mUsdV2Factory = new ContractFactory(MusdV2Abi, MusdV2Bytecode, deployer)
        mUsdV2 = mUsdV2Factory.attach(mUsdProxyAddress)

        delayedProxyAdmin = new DelayedProxyAdmin__factory(governor).attach(delayedProxyAdminAddress)

        const savingsManagerFactory = new ContractFactory(SavingsManagerAbi, SavingsManagerBytecode, governor)
        savingsManager = savingsManagerFactory.attach("0x9781C4E9B9cc6Ac18405891DF20Ad3566FB6B301")
    })
    it("connects to forked V2 via the mUSD proxy", async () => {
        expect(await mUsdV2.getBasketManager(), "basket manager").to.eq(basketManagerAddress)
        await validateTokenStorage(mUsdV2 as Masset)
        await validateUnchangedMassetStorage(mUsdV2 as Masset)
    })
    it("validates delayedProxyAdmin", async () => {
        expect(await delayedProxyAdmin.UPGRADE_DELAY(), "upgrade delay").to.eq(ONE_WEEK)
        expect(await delayedProxyAdmin.getProxyImplementation(mUsdProxyAddress), "delayed proxy admin").to.eq(
            "0xE0d0D052d5B1082E52C6b8422Acd23415c3DF1c4",
        )
        expect(await delayedProxyAdmin.getProxyAdmin(mUsdProxyAddress), "delayed proxy admin").to.eq(delayedProxyAdminAddress)
    })

    /**
     * Step 1: Deploy contract and propose upgrade to begin the 1 week countdown
     *           1. Deploy Migrator & InvariantValidator
     *           2. Deploy mUSD & propose upgrade with initialization data
     * Test 1: i) Deployed mUSDV3 contract has been proposed correctly
     *         ii) Existing storage in BasketManager checks out
     */
    describe("STEP 1: Deploy & propose upgrade", () => {
        it("gets deployed mUSD impl", async () => {
            mUsdV3 = await getMusdv3(deployer)
        })
        it("proposes mUSD upgrade to proxyadmin", async () => {
            const data = await mUsdV3.impl.interface.encodeFunctionData("upgrade", [validatorAddress, defaultConfig])

            const request = await delayedProxyAdmin.requests(mUsdProxyAddress)
            expect(request.data).eq(data)
            expect(request.implementation).eq(mUsdV3.impl.address)
        })
        it("checks nexus address on deployed mUSD", async () => {
            const assignedNexus = await mUsdV3.impl.nexus()
            expect(assignedNexus).eq(nexusAddress)
        })
        it("delays 6 days", async () => {
            await increaseTime(ONE_DAY.mul(6).toNumber())
        })
    })

    /*
     * Step 2: Achieve equilibrium weights & prep
     *           1. Add DAI to CompoundIntegration
     *           2. Add DAI to the basket
     *           3. Set max weights
     *           4. Collect interest
     *           5. Achieve equilibrium weights
     *             - Ensure it cannot be broken
     *           6. Pause BasketManager & SavingsManager
     *           7. Remove TUSD from basket
     * Test 2: i) State at 2.3
     *         ii) Mostly on 2.5 execution
     *         iii) Final state pre-upgrade (everything in place & paused)
     */
    describe("STEP 2 - Achieve equilibrium weights & prep", () => {
        let basketManager: Contract
        const scaledVaultBalances: BN[] = []
        let scaledTargetBalance: BN
        before(async () => {
            const basketManagerFactory = new ContractFactory(BasketManagerV2Abi, BasketManagerV2Bytecode, governor)
            basketManager = basketManagerFactory.attach(basketManagerAddress)
        })
        it("adds DAI to the basket", async () => {
            // 2. Add DAI to basket
            await basketManager.addBasset(DAI.address, DAI.integrator, false)
        })
        it("should get bAssets to check current weights", async () => {
            const { bAssets } = await basketManager.getBassets()
            let scaledTotalVaultBalance = BN.from(0)
            intermediaryBassets.forEach((token, i) => {
                const scaledVaultBalance = applyDecimals(bAssets[i].vaultBalance, token.decimals)
                scaledVaultBalances[i] = scaledVaultBalance
                scaledTotalVaultBalance = scaledTotalVaultBalance.add(scaledVaultBalance)
                expect(bAssets[i].vaultBalance).to.eq(token.vaultBalance)
            })
            scaledTargetBalance = scaledTotalVaultBalance.div(4)
            // Test percentage of basket in basis points. eg 2668 = 26.68%
            expect(scaledVaultBalances[0].mul(10000).div(scaledTotalVaultBalance)).to.eq(0)
            expect(scaledVaultBalances[1].mul(10000).div(scaledTotalVaultBalance)).to.eq(42)
            expect(scaledVaultBalances[2].mul(10000).div(scaledTotalVaultBalance)).to.eq(4494)
            expect(scaledVaultBalances[3].mul(10000).div(scaledTotalVaultBalance)).to.eq(5463)
            expect(scaledVaultBalances[4].mul(10000).div(scaledTotalVaultBalance)).to.eq(0)
        })
        it("should update max weights to 25.01%", async () => {
            // 25.01% where 100% = 1e18
            const maxWeight = simpleToExactAmount(2501, 14)
            await basketManager.setBasketWeights(
                intermediaryBassets.map((token) => token.address),
                [maxWeight, maxWeight, 0, maxWeight, maxWeight],
            )
        })
        it("collects interest one last time", async () => {
            await savingsManager.collectAndDistributeInterest(mUsdV2.address)
        })
        // Step 1. Swap DAI in for TUSD
        // Step 2. Swap sUSD in for else
        // Check: Taking DAI or sUSD out of the basket is not possible once in
        it("should swap DAI for TUSD to balance DAI", async () => {
            await balanceBasset(mUsdV2, scaledVaultBalances, scaledTargetBalance, intermediaryBassets[4], intermediaryBassets[2])
        })
        it("should not be possible to take out the DAI, aside from adding sUSD", async () => {
            // mint not possible with others
            // await expect(mUsdV2.mint(intermediaryBassets[1].address, simpleToExactAmount(1))).to.be.revertedWith("Pausable: paused")
            // redeem into DAI not possible
            // swap into DAI not possible
        })
        it("should swap sUSD for TUSD to balance TUSD", async () => {
            const whale = await impersonate(currentBassets[2].whaleAddress)
            const inputTokenContract = new ERC20__factory(whale).attach(currentBassets[2].address)
            await inputTokenContract.transfer("0x3dfd23a6c5e8bbcfc9581d2e864a68feb6a076d3", simpleToExactAmount(15000000, 18))
            await balanceBasset(mUsdV2, scaledVaultBalances, scaledTargetBalance, currentBassets[0], currentBassets[2])
        })
        it("should swap sUSD for USDT to balance sUSD", async () => {
            await balanceBasset(mUsdV2, scaledVaultBalances, scaledTargetBalance, currentBassets[0], currentBassets[3])
        })
        it("should swap USDC for USDT to balance both USDC and USDT", async () => {
            await balanceBasset(mUsdV2, scaledVaultBalances, scaledTargetBalance, currentBassets[1], currentBassets[3])
        })
        it("should not be possible to take out the sUSD", async () => {
            // mint not possible with others
            // redeem into sUSD not possible
            // swap into sUSD not possible
        })
        it("pauses BasketManager and SavingsManager", async () => {
            // do the pause
            await basketManager.pause()
            await savingsManager.pause()
            // check pause
            expect(await basketManager.paused()).eq(true)
            expect(await savingsManager.paused()).eq(true)
            // check that nothing can be called
            await expect(mUsdV2.mint(intermediaryBassets[0].address, simpleToExactAmount(1))).to.be.revertedWith("Pausable: paused")
            await expect(savingsManager.collectAndStreamInterest(mUsdV2.address)).to.be.revertedWith("Pausable: paused")
        })
        it("removes TUSD from the basket", async () => {
            await basketManager.removeBasset(TUSD.address)
        })
        it("should have valid storage before upgrade", async () => {
            await validateTokenStorage(mUsdV2, "45324893805990774527261941")
            await validateUnchangedMassetStorage(mUsdV2, "1") // bAsset personal data

            // Get new vault balances after the bAssets have been balanced
            const { bAssets } = await basketManager.getBassets()
            finalBassets.forEach((token, i) => {
                balancedVaultBalances[i] = bAssets[i].vaultBalance
                expect(bAssets[i].addr).eq(token.address)
                expect(bAssets[i].maxWeight).eq(simpleToExactAmount(2501, 14))
            })
        })
    })

    /*
     * Step 3: Upgrade mUSD
     *           1. Accept governance proposal
     *           2. Verify storage
     *           3. Unpause system
     * Test 3: i) Upgrade works as intended
     *         ii) All storage has been added & system is paused
     *         iii) Post-unpause: ensure mint, swap, redeem all work as expected
     *         iv) Collect interest & platform interest work
     *         v) Do some admin operations
     */
    describe("STEP 3 - Upgrading mUSD", () => {
        before("elapse the time", async () => {
            await increaseTime(ONE_DAY.mul(2))
        })
        // TODO - ensure all libs are tested:
        // - migrator
        // - manager
        // - validator
        describe("accept proposal and verify storage", () => {
            it("Should upgrade balanced mUSD", async () => {
                // Approve and execute call to upgradeToAndCall on mUSD proxy which then calls migrate on the new mUSD V3 implementation
                await delayedProxyAdmin.acceptUpgradeRequest(mUsdProxyAddress)

                // validate after the upgrade
                await validateTokenStorage(mUsdV3.proxy, "45324893805990774527261941")
                await validateUnchangedMassetStorage(mUsdV3.proxy, "1")
                await validateNewMassetStorage(mUsdV3.proxy, validatorAddress, balancedVaultBalances)
            })
            it("blocks mint/swap/redeem", async () => {
                // mint/swap = Unhealthy
                await expect(mUsdV3.proxy.mint(finalBassets[0].address, simpleToExactAmount(1), 0, DEAD_ADDRESS)).to.be.revertedWith(
                    "Unhealthy",
                )
                await expect(
                    mUsdV3.proxy.mintMulti([finalBassets[0].address], [simpleToExactAmount(1)], 0, DEAD_ADDRESS),
                ).to.be.revertedWith("Unhealthy")
                await expect(
                    mUsdV3.proxy.swap(finalBassets[0].address, finalBassets[1].address, simpleToExactAmount(1), 0, DEAD_ADDRESS),
                ).to.be.revertedWith("Unhealthy")
                // redeem = In recol
                await expect(mUsdV3.proxy.redeem(finalBassets[0].address, simpleToExactAmount(1), 0, DEAD_ADDRESS)).to.be.revertedWith(
                    "In recol",
                )
                await expect(
                    mUsdV3.proxy.redeemExactBassets([finalBassets[0].address], [simpleToExactAmount(1)], 0, DEAD_ADDRESS),
                ).to.be.revertedWith("In recol")
                await expect(mUsdV3.proxy.redeemMasset(simpleToExactAmount(1), [0], DEAD_ADDRESS)).to.be.revertedWith("In recol")
            })
            it("blocks interest collection", async () => {
                // collectAndDistributeInterest
                await expect(savingsManager.collectAndDistributeInterest(mUsdV3.proxy.address)).to.be.revertedWith("Pausable: paused")
                // collectAndStreamInterest
                await expect(savingsManager.collectAndStreamInterest(mUsdV3.proxy.address)).to.be.revertedWith("Pausable: paused")
            })
            it("Should fail to upgrade mUSD again", async () => {
                await expect(mUsdV3.proxy.upgrade(validatorAddress, defaultConfig)).to.revertedWith("already upgraded")
            })
        })
        describe("unpause system and test", () => {
            it("Enables mUSD after upgrade", async () => {
                await savingsManager.unpause()
                await mUsdV3.proxy.connect(governor).negateIsolation(finalBassets[0].address)
                // Get basket state
                const basketState = await mUsdV3.proxy.basket()
                expect(basketState.undergoingRecol, "undergoingRecol").to.be.false
                expect(basketState[0], "basketState[0]").to.be.false
                expect(basketState.failed, "undergoingRecol").to.be.false
                expect(basketState[1], "basketState[1]").to.be.false
            })
            it("Should mint after upgrade", async () => {
                const token = finalBassets[0]
                const signer = await impersonate(token.whaleAddress)
                const tokenContract = new ERC20__factory(signer).attach(token.address)
                const qty = simpleToExactAmount(10000, token.decimals)
                expect(await tokenContract.balanceOf(token.whaleAddress)).gte(qty)
                await tokenContract.approve(mUsdProxyAddress, qty)

                // Slippage protection check
                await expect(
                    mUsdV3.proxy.connect(signer).mint(token.address, qty, simpleToExactAmount(10001), await signer.getAddress()),
                ).to.be.revertedWith("Mint quantity < min qty")

                // Real mint
                const tx = mUsdV3.proxy.connect(signer).mint(token.address, qty, simpleToExactAmount(9999), await signer.getAddress())
                await expect(tx, "Minted event").to.emit(mUsdV3.proxy, "Minted")
                await (await tx).wait()
            })
            it("Should mintMulti after upgrade", async () => {
                const token = finalBassets[1]
                const signer = await impersonate(token.whaleAddress)
                const tokenContract = new ERC20__factory(signer).attach(token.address)
                const qty = simpleToExactAmount(10000, token.decimals)
                expect(await tokenContract.balanceOf(token.whaleAddress)).gte(qty)
                await tokenContract.approve(mUsdProxyAddress, qty)
                // Slippage protection check
                await expect(
                    mUsdV3.proxy.connect(signer).mintMulti([token.address], [qty], simpleToExactAmount(10001), await signer.getAddress()),
                ).to.be.revertedWith("Mint quantity < min qty")

                // Real mint
                const tx = mUsdV3.proxy
                    .connect(signer)
                    .mintMulti([token.address], [qty], simpleToExactAmount(9999), await signer.getAddress())
                await expect(tx, "Minted event").to.emit(mUsdV3.proxy, "MintedMulti")
                await (await tx).wait()
            })
            it("Should swap after upgrade", async () => {
                const token = finalBassets[2]
                const signer = await impersonate(token.whaleAddress)
                const tokenContract = new ERC20__factory(signer).attach(token.address)
                const qty = simpleToExactAmount(10000, token.decimals)
                expect(await tokenContract.balanceOf(token.whaleAddress)).gte(qty)
                await tokenContract.approve(mUsdProxyAddress, qty)
                // Slippage protection check
                await expect(
                    mUsdV3.proxy
                        .connect(signer)
                        .swap(
                            token.address,
                            finalBassets[3].address,
                            qty,
                            simpleToExactAmount(10001, finalBassets[3].decimals),
                            await signer.getAddress(),
                        ),
                ).to.be.revertedWith("Output qty < minimum qty")

                // Real mint
                const tx = mUsdV3.proxy
                    .connect(signer)
                    .swap(
                        token.address,
                        finalBassets[3].address,
                        qty,
                        simpleToExactAmount(9990, finalBassets[3].decimals),
                        await signer.getAddress(),
                    )
                await expect(tx, "Swapped event").to.emit(mUsdV3.proxy, "Swapped")
                await (await tx).wait()
            })
            it("Should redeem after upgrade", async () => {
                const token = finalBassets[3]
                const signer = await impersonate(mUsdWhaleAddress)
                const qty = simpleToExactAmount(10000, 18)
                // Slippage protection check
                await expect(
                    mUsdV3.proxy
                        .connect(signer)
                        .redeem(token.address, qty, simpleToExactAmount(10001, token.decimals), await signer.getAddress()),
                ).to.be.revertedWith("bAsset qty < min qty")

                // Real mint
                const tx = mUsdV3.proxy
                    .connect(signer)
                    .redeem(token.address, qty, simpleToExactAmount(9990, token.decimals), await signer.getAddress())
                await expect(tx, "Redeem event").to.emit(mUsdV3.proxy, "Redeemed")
                await (await tx).wait()
            })
            it("Should redeemExact after upgrade", async () => {
                const token = finalBassets[0]
                const signer = await impersonate(mUsdWhaleAddress)
                // Slippage protection check
                await expect(
                    mUsdV3.proxy
                        .connect(signer)
                        .redeemExactBassets(
                            [token.address],
                            [simpleToExactAmount(10000, token.decimals)],
                            simpleToExactAmount(9999),
                            await signer.getAddress(),
                        ),
                ).to.be.revertedWith("Redeem mAsset qty > max quantity")

                // Real mint
                const tx = mUsdV3.proxy
                    .connect(signer)
                    .redeemExactBassets(
                        [token.address],
                        [simpleToExactAmount(10000, token.decimals)],
                        simpleToExactAmount(10010),
                        await signer.getAddress(),
                    )
                await expect(tx, "Redeem event").to.emit(mUsdV3.proxy, "RedeemedMulti")
                await (await tx).wait()
            })
            it("Should redeemMasset after upgrade", async () => {
                const signer = await impersonate(mUsdWhaleAddress)
                // Slippage protection check
                await expect(
                    mUsdV3.proxy.connect(signer).redeemMasset(
                        simpleToExactAmount(10000),
                        finalBassets.map((b) => simpleToExactAmount(2501, b.decimals)),
                        await signer.getAddress(),
                    ),
                ).to.be.revertedWith("bAsset qty < min qty")

                // Real mint
                const tx = mUsdV3.proxy.connect(signer).redeemMasset(
                    simpleToExactAmount(10000),
                    finalBassets.map((b) => simpleToExactAmount(2490, b.decimals)),
                    await signer.getAddress(),
                )
                await expect(tx, "Redeem event").to.emit(mUsdV3.proxy, "RedeemedMulti")
                await (await tx).wait()
            })
            it("should collect interest after upgrade", async () => {
                await savingsManager.collectAndDistributeInterest(mUsdV3.proxy.address)
            })
            it("should stream interest after upgrade", async () => {
                await savingsManager.collectAndStreamInterest(mUsdV3.proxy.address)
            })
        })
    })
    context.only("Add DAI and balance mUSD bAssets on-chain using DyDx flash loans at block 12072000", () => {
        let basketManager: Contract
        let mUsdRebalance: MusdV3Rebalance4Pool
        let scaledTargetBalance: BN
        let swapInputTusd: BN
        let swapInputUsdt: BN
        before(async () => {
            await network.provider.request({
                method: "hardhat_reset",
                params: [
                    {
                        forking: {
                            jsonRpcUrl: process.env.NODE_URL,
                            blockNumber: 12072000,
                        },
                    },
                ],
            })
            accounts = await impersonateAccounts()

            const basketManagerFactory = new ContractFactory(BasketManagerV2Abi, BasketManagerV2Bytecode, accounts.governor)
            basketManager = basketManagerFactory.attach(basketManagerAddress)

            const musdTotal = await mUsdV2.totalSupply()
            // 25% of mUSD supply
            scaledTargetBalance = musdTotal.div(4)
            console.log(`Target mUSD bAsset balance ${formatUnits(scaledTargetBalance)}`)
        })
        it("Add DAI to the mUSD basket", async () => {
            const tx = basketManager.addBasset(DAI.address, DAI.integrator, false)
            await expect(tx).to.emit(basketManager, "BassetAdded").withArgs(DAI.address, DAI.integrator)
            const { bAssets } = await basketManager.getBassets()
            expect(bAssets).to.length(5)
            expect(bAssets[4].maxWeight).to.eq(0)
        })
        it("should update max weights to 25.1%", async () => {
            // 25.1% where 100% = 1e18
            const maxWeight = simpleToExactAmount(251, 15)
            const tx = basketManager.setBasketWeights(
                [sUSD.address, USDC.address, TUSD.address, USDT.address, DAI.address],
                [maxWeight, maxWeight, 0, maxWeight, maxWeight],
            )
            await expect(tx).to.emit(basketManager, "BasketWeightsUpdated")
            const { bAssets } = await basketManager.getBassets()
            expect(bAssets).to.length(5)
            expect(bAssets[0].maxWeight).to.eq(maxWeight)
            expect(bAssets[1].maxWeight).to.eq(maxWeight)
            expect(bAssets[2].maxWeight).to.eq(0)
            expect(bAssets[3].maxWeight).to.eq(maxWeight)
            expect(bAssets[4].maxWeight).to.eq(maxWeight)
        })
        it("Deploy rebalance contract", async () => {
            const mUsdUpgradeFactory = new MusdV3Rebalance4Pool__factory(accounts.deployer)
            mUsdRebalance = await mUsdUpgradeFactory.deploy()
        })
        it("whales approve rebalance contract to fund loan shortfalls", async () => {
            // whale approves upgrade contract to spend their sUSD
            const sUsdWhaleSigner = await impersonate(sUSD.whaleAddress)
            const susd = new ERC20__factory(sUsdWhaleSigner).attach(sUSD.address)
            await susd.approve(mUsdRebalance.address, simpleToExactAmount(12000000, sUSD.decimals))

            // whale approves upgrade contract to spend their USDC
            const usdcWhaleSigner = await impersonate(USDC.whaleAddress)
            const usdc = new ERC20__factory(usdcWhaleSigner).attach(USDC.address)
            await usdc.approve(mUsdRebalance.address, simpleToExactAmount(30000, USDC.decimals))

            // whale approves upgrade contract to spend their DAI
            const daiWhaleSigner = await impersonate(DAI.whaleAddress)
            const dai = new ERC20__factory(daiWhaleSigner).attach(DAI.address)
            await dai.approve(mUsdRebalance.address, simpleToExactAmount(30000, DAI.decimals))
        })
        it("use USDC flash loan from DyDx to balance mUSD bAssets", async () => {
            const flashToken = USDC
            // Get USDC in mUSD
            const usdcInMusd = await basketManager.getBasset(USDC.address)
            // convert target balance with 18 decimals back to USDC's 6 decimals
            // USDC loan amount = target balance - current balance
            const usdcLoanAmount = scaledTargetBalance.div(1e12).sub(usdcInMusd.vaultBalance)
            console.log(
                `USDC loan amount ${formatUnits(usdcLoanAmount, USDC.decimals)} = ${scaledTargetBalance.div(1e12)} target - ${
                    usdcInMusd.vaultBalance
                } USDC vault balance`,
            )

            const tusdInMusd = await basketManager.getBasset(TUSD.address)
            // USDC to TUSD swap input is TUSD amount over target / 3 converted from 18 to 6 decimal places
            swapInputTusd = tusdInMusd.vaultBalance.sub(scaledTargetBalance).div(3e12)

            console.log(
                `${formatUnits(swapInputTusd, flashToken.decimals)} USDC swap input for TUSD = (${
                    tusdInMusd.vaultBalance
                } TUSD - target ${scaledTargetBalance}) / 3e12`,
            )
            // USDC to USDT swap input is USDT amount over target converted from 18 to 6 decimal places / 3
            const usdtInMusd = await basketManager.getBasset(TUSD.address)
            swapInputUsdt = usdtInMusd.vaultBalance.sub(scaledTargetBalance).div(3e12)
            console.log(
                `${formatUnits(swapInputUsdt, flashToken.decimals)} USDC swap input for USDT = (${
                    usdtInMusd.vaultBalance
                } USDT - target ${scaledTargetBalance}) / 3e12`,
            )
            const swapInputsUsdc = [swapInputTusd, swapInputUsdt]

            // Check Aave V1 has enough TUSD for the USDC loan
            const tusd = new ERC20__factory(accounts.deployer).attach(TUSD.address)
            const aaveV1Address = "0x3dfd23a6c5e8bbcfc9581d2e864a68feb6a076d3"
            const aaveV1TusdBalance = await tusd.balanceOf(aaveV1Address)
            expect(aaveV1TusdBalance, "Aave V1 TUSD balance > scaled loan amount").to.gte(swapInputsUsdc[0])

            /**
             Flash loan USDC from DyDx
             Swap USDC for TUSD using mUSD
             Swap USDC for USDT using mUSD
             Swap TUSD for USDC using Curve Y pool
             Swap USDT for USDC using Curve 3pool
             Fund the DyDx USDC flash loan shortfall
            */
            const tx = mUsdRebalance.swapOutTusdAndUsdt(flashToken.address, usdcLoanAmount, USDC.whaleAddress, swapInputsUsdc)
            await expect(tx).to.emit(mUsdRebalance, "FlashLoan")
            const resolvedTx = await tx
            const receipt = await resolvedTx.wait()

            // Get mUSD swap events
            const musdSwap4TusdEvent = receipt.events.find((e) => e.event === "Swapped" && e.args?.output === TUSD.address)
            if (musdSwap4TusdEvent) {
                console.log(
                    `mUSD swap: ${formatUnits(swapInputsUsdc[0], flashToken.decimals)} ${flashToken.symbol} -> ${formatUnits(
                        musdSwap4TusdEvent?.args?.outputAmount,
                        TUSD.decimals,
                    )} TUSD`,
                )
            }
            const musdSwap4UsdtEvent = receipt.events.find((e) => e.event === "Swapped" && e.args?.output === USDT.address)
            if (musdSwap4UsdtEvent) {
                console.log(
                    `mUSD swap: ${formatUnits(swapInputsUsdc[1], flashToken.decimals)} ${flashToken.symbol} -> ${formatUnits(
                        musdSwap4UsdtEvent?.args?.outputAmount,
                        USDT.decimals,
                    )} USDT`,
                )
            }

            const yPoolSwapEvent = receipt.events.find((e) => e.event === "TokenExchangeUnderlying")
            if (yPoolSwapEvent) {
                const swapRate = yPoolSwapEvent?.args?.tokens_bought
                    .mul(1e12) // scale USDC up to 18 decimal places
                    .sub(yPoolSwapEvent?.args?.tokens_sold)
                    .mul(1000)
                    .div(yPoolSwapEvent?.args?.tokens_sold)
                console.log(
                    `Curve Y pool swap: ${formatUnits(yPoolSwapEvent?.args?.tokens_sold, TUSD.decimals)} TUSD -> ${formatUnits(
                        yPoolSwapEvent?.args?.tokens_bought,
                        flashToken.decimals,
                    )} ${flashToken.symbol} (${swapRate} bps swap rate)`,
                )
            }

            const curve3PoolSwapEvent = receipt.events.find((e) => e.event === "TokenExchange")
            if (curve3PoolSwapEvent) {
                const swapRate = curve3PoolSwapEvent?.args?.tokens_bought
                    .sub(curve3PoolSwapEvent?.args?.tokens_sold)
                    .mul(1000)
                    .div(curve3PoolSwapEvent?.args?.tokens_sold)
                console.log(
                    `Curve 3pool swap: ${formatUnits(curve3PoolSwapEvent?.args?.tokens_sold, USDT.decimals)} USDT -> ${formatUnits(
                        curve3PoolSwapEvent?.args?.tokens_bought,
                        flashToken.decimals,
                    )} ${flashToken.symbol} (${swapRate} bps swap rate)`,
                )
            }

            // Get Flash Loan event
            const flashLoanEvent = receipt.events.find((e) => e.event === "FlashLoan" && e.args.flashToken === flashToken.address)
            expect(flashLoanEvent, "no FlashLoan event").to.not.undefined
            console.log(`${flashToken.symbol} shortfall ${formatUnits(flashLoanEvent?.args?.flashLoanShortfall, flashToken.decimals)}`)

            const txUsd = receipt.gasUsed
                .mul(gasPriceGwei)
                .mul(ethUsd)
                .div(BN.from(10).pow(18 - 9))
            console.log(`tx used ${receipt.gasUsed} gas at price ${gasPriceGwei} Gwei (${txUsd} USD)`)
        })
        it("use DAI flash loan from DyDx to balance mUSD bAssets", async () => {
            const flashToken = DAI
            // Get DAI in mUSD
            const daiInMusd = await basketManager.getBasset(DAI.address)
            // DAI loan amount = target balance - current balance
            const daiLoanAmount = scaledTargetBalance.sub(daiInMusd.vaultBalance)
            console.log(
                `DAI loan amount ${formatUnits(daiLoanAmount, DAI.decimals)} = ${scaledTargetBalance} target - ${
                    daiInMusd.vaultBalance
                } DAI vault balance`,
            )
            const swapInputsDai = [swapInputTusd.mul(1e12), swapInputUsdt.mul(1e12)]

            /**
             Flash loan DAI from DyDx
             Swap DAI for TUSD using mUSD
             Swap DAI for USDT using mUSD
             Swap TUSD for DAI using Curve Y pool
             Swap USDT for DAI using Curve 3pool
             Fund the DyDx DAI flash loan shortfall
            */
            const tx = mUsdRebalance.swapOutTusdAndUsdt(flashToken.address, daiLoanAmount, DAI.whaleAddress, swapInputsDai)
            await expect(tx).to.emit(mUsdRebalance, "FlashLoan")
            const resolvedTx = await tx
            const receipt = await resolvedTx.wait()

            // Get mUSD swap events
            const musdSwap4TusdEvent = receipt.events.find((e) => e.event === "Swapped" && e.args?.output === TUSD.address)
            if (musdSwap4TusdEvent) {
                console.log(
                    `mUSD swap: ${formatUnits(swapInputsDai[0], flashToken.decimals)} ${flashToken.symbol} -> ${formatUnits(
                        musdSwap4TusdEvent?.args?.outputAmount,
                        TUSD.decimals,
                    )} TUSD`,
                )
            }
            const musdSwap4UsdtEvent = receipt.events.find((e) => e.event === "Swapped" && e.args?.output === USDT.address)
            if (musdSwap4UsdtEvent) {
                console.log(
                    `mUSD swap: ${formatUnits(swapInputsDai[1], flashToken.decimals)} ${flashToken.symbol} -> ${formatUnits(
                        musdSwap4UsdtEvent?.args?.outputAmount,
                        USDT.decimals,
                    )} USDT`,
                )
            }

            const yPoolSwapEvent = receipt.events.find((e) => e.event === "TokenExchangeUnderlying")
            if (yPoolSwapEvent) {
                const swapRate = yPoolSwapEvent?.args?.tokens_bought
                    .mul(1e12) // scale USDC up to 18 decimal places
                    .sub(yPoolSwapEvent?.args?.tokens_sold)
                    .mul(1000)
                    .div(yPoolSwapEvent?.args?.tokens_sold)
                console.log(
                    `Curve Y pool swap: ${formatUnits(yPoolSwapEvent?.args?.tokens_sold, TUSD.decimals)} TUSD -> ${formatUnits(
                        yPoolSwapEvent?.args?.tokens_bought,
                        flashToken.decimals,
                    )} ${flashToken.symbol} (${swapRate} bps swap rate)`,
                )
            }

            const curve3PoolSwapEvent = receipt.events.find((e) => e.event === "TokenExchange")
            if (curve3PoolSwapEvent) {
                const swapRate = curve3PoolSwapEvent?.args?.tokens_bought
                    .sub(curve3PoolSwapEvent?.args?.tokens_sold)
                    .mul(1000)
                    .div(curve3PoolSwapEvent?.args?.tokens_sold)
                console.log(
                    `Curve 3pool swap: ${formatUnits(curve3PoolSwapEvent?.args?.tokens_sold, USDT.decimals)} USDT -> ${formatUnits(
                        curve3PoolSwapEvent?.args?.tokens_bought,
                        flashToken.decimals,
                    )} ${flashToken.symbol} (${swapRate} bps swap rate)`,
                )
            }

            // Get Flash Loan event
            const flashLoanEvent = receipt.events.find((e) => e.event === "FlashLoan" && e.args.flashToken === flashToken.address)
            expect(flashLoanEvent, "no FlashLoan event").to.not.undefined
            console.log(`${flashToken.symbol} shortfall ${formatUnits(flashLoanEvent?.args?.flashLoanShortfall, flashToken.decimals)}`)

            const txUsd = receipt.gasUsed
                .mul(gasPriceGwei)
                .mul(ethUsd)
                .div(BN.from(10).pow(18 - 9))
            console.log(`tx used ${receipt.gasUsed} gas at price ${gasPriceGwei} Gwei (${txUsd} USD)`)
        })
    })
})