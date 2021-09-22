import { ethers } from "hardhat"
import { expect } from "chai"
import { simpleToExactAmount, BN } from "@utils/math"
import { assertBNClose } from "@utils/assertions"
import { StandardAccounts, MassetMachine } from "@utils/machines"
import { fullScale, ZERO_ADDRESS, ZERO, ONE_DAY, DEAD_ADDRESS } from "@utils/constants"
import {
    TokenLocker,
    TokenLocker__factory,
    SavingsContract,
    MockERC20__factory,
    MockConnector__factory,
    MockNexus__factory,
    MockNexus,
    MockMasset,
    MockMasset__factory,
    SavingsContract__factory,
    MockSavingsManager__factory,
    AssetProxy__factory,
} from "types/generated"
import { Account } from "types"
import { getTimestamp, increaseTime } from "@utils/time"

const SIX_MONTHS = BN.from(60 * 60 * 24 * 7 * 4 * 6)
interface Balances {
    totalCredits: BN
    userCredits: BN
    lockerCredits: BN
    user: BN
    contract: BN
    lockerContract: BN
    savingsContract: BN
}

interface ConnectorData {
    lastPoke: BN
    lastBalance: BN
    fraction: BN
    address: string
    balance: BN
}

interface Data {
    balances: Balances
    exchangeRate: BN
    connector: ConnectorData
}

const underlyingToCredits = (amount: BN | number, exchangeRate: BN): BN => BN.from(amount).mul(fullScale).div(exchangeRate).add(1)

const creditsToUnderlying = (amount: BN, exchangeRate: BN): BN => amount.mul(exchangeRate).div(fullScale)

const getData = async (contract: TokenLocker, user: Account): Promise<Data> => {
    const savingsFactory = await new SavingsContract__factory(user.signer)
    const savingsContract = await savingsFactory.attach(await contract.SAVINGS_CONTRACT())   
    // const savingsContract =  new SavingsContract(await contract.SAVINGS_CONTRACT())   
    const mAsset = await (await new MockERC20__factory(user.signer)).attach(await savingsContract.underlying())
    const connectorAddress = await savingsContract.connector()
    let connectorBalance = BN.from(0)
    if (connectorAddress !== ZERO_ADDRESS) {
        const connector = await (await new MockConnector__factory(user.signer)).attach(connectorAddress)
        connectorBalance = await connector.checkBalance()
    }
    const data = {
        balances: {
            totalCredits: await savingsContract.totalSupply(),
            userCredits: await savingsContract.balanceOf(user.address),
            lockerCredits: await savingsContract.balanceOf(contract.address),
            user: await mAsset.balanceOf(user.address),
            contract: await mAsset.balanceOf(contract.address),
            lockerContract: await contract.balanceOf(user.address),
            savingsContract: await mAsset.balanceOf(savingsContract.address),
        },
        exchangeRate: await savingsContract.exchangeRate(),
        connector: {
            lastPoke: await savingsContract.lastPoke(),
            lastBalance: await savingsContract.lastBalance(),
            fraction: await savingsContract.fraction(),
            address: connectorAddress,
            balance: connectorBalance,
        },
    };
    // console.log(`TS: getData`)
    // console.log(`TS:    address         ${user.address}`)
    // console.log(`TS:    contract        ${data.balances.contract.toString()}`)
    // console.log(`TS:    lockerContract  ${data.balances.lockerContract.toString()}`)
    // console.log(`TS:    savingsContract ${data.balances.savingsContract.toString()}`)
    // console.log(`TS:    totalCredits    ${data.balances.totalCredits.toString()}`)
    // console.log(`TS:    user            ${data.balances.user.toString()}`)
    // console.log(`TS:    userCredits     ${data.balances.userCredits.toString()}`)
    // console.log(`TS:    lockerCredits   ${data.balances.lockerCredits.toString()}`)

    return data
}

/**
 * @notice Returns bool to signify whether the total collateral held is redeemable
 */
const exchangeRateHolds = (data: Data): boolean => {
    const { balances, connector, exchangeRate } = data
    const collateral = balances.contract.add(connector.balance)
    return collateral.gte(creditsToUnderlying(balances.totalCredits, exchangeRate))
}

describe("TokenLocker", async () => {
    let sa: StandardAccounts
    let manager: Account
    let alice: Account
    const initialExchangeRate = simpleToExactAmount(1, 17)

    let mAssetMachine: MassetMachine
    let tokenLocker: TokenLocker
    let tokenLockerFactory: TokenLocker__factory
    let savingsContract: SavingsContract
    let savingsFactory: SavingsContract__factory
    let nexus: MockNexus
    let masset: MockMasset

    const createNewSavingsContract = async (): Promise<void> => {
        // Use a mock Nexus so we can dictate addresses
        nexus = await (await new MockNexus__factory(sa.default.signer)).deploy(sa.governor.address, manager.address, DEAD_ADDRESS)
        // Use a mock mAsset so we can dictate the interest generated
        masset = await (await new MockMasset__factory(sa.default.signer)).deploy("MOCK", "MOCK", 18, sa.default.address, 1000000000)

        savingsFactory = await new SavingsContract__factory(sa.default.signer)
        const impl = await savingsFactory.deploy(nexus.address, masset.address)
        const data = impl.interface.encodeFunctionData("initialize", [sa.default.address, "Savings Credit", "imUSD"])
        const proxy = await (await new AssetProxy__factory(sa.default.signer)).deploy(impl.address, sa.dummy4.address, data)
        savingsContract = await savingsFactory.attach(proxy.address)

        // Use a mock SavingsManager so we don't need to run integrations
        const mockSavingsManager = await (await new MockSavingsManager__factory(sa.default.signer)).deploy(savingsContract.address)
        await nexus.setSavingsManager(mockSavingsManager.address)
    }

    const createNewTokenLockerContract = async (): Promise<void> => {
        await createNewSavingsContract()
        tokenLockerFactory = await new TokenLocker__factory(sa.default.signer)
        tokenLocker = await tokenLockerFactory.deploy(masset.address, savingsContract.address)
    }

    before(async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        manager = sa.dummy2
        alice = sa.default
        await createNewTokenLockerContract()
    })


    describe("constructor", async () => {
        it("should fail when masset/SavingsContract address is zero", async () => {
            await expect(tokenLockerFactory.deploy(ZERO_ADDRESS, savingsContract.address)).to.be.revertedWith("Locker: mAsset address is zero")
            await expect(tokenLockerFactory.deploy(masset.address, ZERO_ADDRESS)).to.be.revertedWith("Locker: SavingContract address is zero")
        })

        it("should succeed and set valid parameters", async () => {
            await createNewTokenLockerContract()
            expect(await tokenLocker.LOCKED_TOKEN(), "locked token").to.eq(masset.address)
            // expect(await tokenLocker.REWARDS_TOKEN(), "reward token").to.eq(rewardToken.address)
            expect(await tokenLocker.SAVINGS_CONTRACT(), "SavingsContract").to.eq(savingsContract.address)
            expect(await tokenLocker.getDuration(), "lock up period").to.eq(SIX_MONTHS)
        })
    })


    describe("locking savings", async () => {
        context("using depositSavings", async () => {
            before(async () => {
                await createNewTokenLockerContract()
            })
            afterEach(async () => {
                // const data = await getData(tokenLocker, alice)
                // expect(exchangeRateHolds(data), "Exchange rate must hold")
            })
            it("should fail when amount is zero", async () => {
                await expect(tokenLocker.lock(ZERO)).to.be.revertedWith("Locker: Must lock non zero amount")
            })
            it("should fail if the user has no balance", async () => {
                const deposit = simpleToExactAmount(1, 18)
                // Check balance
                const balance = await masset.balanceOf(sa.dummy1.address)
                expect(balance).to.equal(0)
                // Approve first
                await masset.connect(sa.dummy1.signer).approve(tokenLocker.address, deposit)

                // Lock
                await expect(
                    tokenLocker.connect(sa.dummy1.signer).lock(deposit),
                ).to.be.revertedWith("VM Exception")
            })
            it("should fail if the user has no balance", async () => {
                // 1. Approve the savings contract to spend mUSD
                await masset.approve(tokenLocker.address, simpleToExactAmount(1, 18))
                // Lock
                await expect(tokenLocker.lock(simpleToExactAmount(2, 18)),
                ).to.be.revertedWith("ERC20: transfer amount exceeds allowance")
            })            
            it("should deposit the mUSD and assign credits to the locker", async () => {
                const dataBefore = await getData(tokenLocker, sa.default)
                const deposit = simpleToExactAmount(1, 18)

                // Check balance
                const balance = await masset.balanceOf(sa.default.address)
                expect(balance).gt(0)          

                // 1. Approve the savings contract to spend mUSD
                await masset.approve(tokenLocker.address, deposit)
                // 2. Deposit the mUSD
                const startTime = await getTimestamp()
                const tx = tokenLocker.lock(deposit)
                const expectedCredits = underlyingToCredits(deposit, initialExchangeRate)
                
                await expect(tx).to.emit(tokenLocker, "Locked").withArgs(sa.default.address, deposit, startTime.add(SIX_MONTHS).add(1))
                // assertBNClose(config.a, BN.from(testData.expectedValaue), 20)

                // const receipt = await (await tx).wait()
                // await expect(tx).to.emit(tokenLocker, "Locked")
                // const depositEvent = findContractEvent(receipt, tokenLocker.address, "Locked")
                // expect(depositEvent).to.exist
                // expect(depositEvent.args.user, "provider in Deposit event").to.eq(sender.address)
                // expect(depositEvent.args.amount, "value in Deposit event").to.eq(expectedAmount)
                // expect(depositEvent.args.releaseTime, "locktime in Deposit event").to.eq(expectedLocktime)
                // expect(depositEvent.args.action, "action in Deposit event").to.eq(lockAction)
                // assertBNClose(depositEvent.args.ts, (await getTimestamp()).add(1), BN.from(10), "ts in Deposit event")



                await expect(tx).to.emit(savingsContract, "SavingsDeposited").withArgs(tokenLocker.address, deposit, expectedCredits)

                const dataAfter = await getData(tokenLocker, sa.default)
                expect(dataAfter.balances.userCredits).eq(0, "Must receive some savings credits")
                expect(dataAfter.balances.lockerCredits).eq(expectedCredits, "Must receive some savings credits")

                expect(dataAfter.balances.totalCredits).eq(expectedCredits)
                expect(dataAfter.balances.user).eq(dataBefore.balances.user.sub(deposit))
                // Locker contract must not hold any mAsset
                expect(dataAfter.balances.contract).eq(0)
                // lockerContract tracks the lock amount of the user.
                expect(dataAfter.balances.lockerContract).eq(deposit)
                // SavingsContract contract must hold the mAsse.
                expect(dataAfter.balances.savingsContract).eq(deposit)
            })
            it("should deposit multiple times and change the lock time", async () => {
                // const dataBefore = await getData(tokenLocker, sa.default)
                const deposit = simpleToExactAmount(1, 18)

                // Check balance
                const balance = await masset.balanceOf(sa.default.address)
                expect(balance).gt(0)          

                // 1. Approve the savings contract to spend mUSD
                await masset.approve(tokenLocker.address, deposit)
                // 2. Deposit the mUSD
                await tokenLocker.lock(deposit)
                const expectedCredits = underlyingToCredits(deposit, initialExchangeRate)
                

                const [amount0, credit0, end0] = await tokenLocker.lockedBalances(sa.default.address)
                // Increase some time 
                await increaseTime(ONE_DAY)
                // console.log(`lockedBalance0 ${amount0.toString()}, ${credit0.toString()}, ${end0.toString()}`)

                // Deposit again 
                await masset.approve(tokenLocker.address, deposit)
                await tokenLocker.lock(deposit)
                const [amount1, credit1, end1] = await tokenLocker.lockedBalances(sa.default.address)

                // console.log(`lockedBalance1 ${amount1.toString()}, ${credit1.toString()}, ${end1.toString()}`)

                expect(end0).eq(end1, "If locktime has not expire it should not change")


                const dataAfter = await getData(tokenLocker, sa.default)
                expect(dataAfter.balances.userCredits).eq(0, "Must receive some savings credits")
                expect(dataAfter.balances.lockerCredits).eq(expectedCredits.mul(3), "Must receive some savings credits")

                expect(dataAfter.balances.totalCredits).eq(expectedCredits.mul(3))
                // expect(dataAfter.balances.user).eq(dataBefore.balances.user.sub(deposit.mul(3)))
                // Locker contract must not hold any mAsset
                expect(dataAfter.balances.contract).eq(0)
                // lockerContract tracks the lock amount of the user.
                expect(dataAfter.balances.lockerContract).eq(deposit.mul(3))
                // SavingsContract contract must hold the mAsse.
                expect(dataAfter.balances.savingsContract).eq(deposit.mul(3))
            })

            it("should fail batch processor", async () => {
                await tokenLocker.setBatchEnable(false)
                await expect(tokenLocker.batchExecute()).to.be.revertedWith("Locker: Batch mode is not enable")

                await tokenLocker.setBatchEnable(true)

                await expect(tokenLocker.batchExecute()).to.be.revertedWith("Locker: Batch amount insufficient")
            })
            it("should run batch processor after 10000", async () => {
                await tokenLocker.setBatchEnable(true)
                const depositAmount1 = simpleToExactAmount(4, 18);
                const depositAmount2 =  simpleToExactAmount(10000, 18);
                // Lock
                await masset.approve(tokenLocker.address, simpleToExactAmount(1, 18))
                await tokenLocker.lock(simpleToExactAmount(1, 18))
                const [amount, credit, end, locked] = await tokenLocker.lockedBalances(sa.default.address)
                expect(amount).eq(depositAmount1)
                expect(locked).eq(false)
                // Not enough amount to run batch 
                await expect(tokenLocker.batchExecute()).to.be.revertedWith("Locker: Batch amount insufficient")
                
                // Deposit again  to reach batch threshold 
                await masset.approve(tokenLocker.address, simpleToExactAmount(10000, 18))
                await tokenLocker.lock(depositAmount2)
                const [amount1, credit1, end1, locked1] = await tokenLocker.lockedBalances(sa.default.address)
                expect(amount1).eq(depositAmount1.add(depositAmount2))
                expect(locked1).eq(false)

                await tokenLocker.batchExecute()

                const [amount2, credit2, end2, locked2] = await tokenLocker.lockedBalances(sa.default.address)
                expect(amount2).eq(depositAmount1.add(depositAmount2))
                // Batch should lock  the balance
                expect(locked2).eq(true)


            })

        })
    })
    describe("redeeming", async () => {
        before(async () => {
            await createNewTokenLockerContract()
        })
        it("should fail when user balance is zero", async () => {
            await expect(tokenLocker.withdraw()).to.be.revertedWith("Locker: Must have something to withdraw")
        })
        it("should fail when lock period is has not finished", async () => {
            const deposit = simpleToExactAmount(1, 18)
            await createNewTokenLockerContract()
            await masset.approve(tokenLocker.address, deposit)
            await tokenLocker.lock(deposit)
            await expect(tokenLocker.withdraw()).to.be.revertedWith("Locker: Lock period didn't expire'")

        })
        context("using redeemCredits", async () => {
            const deposit = simpleToExactAmount(10, 18)
            const credits = underlyingToCredits(deposit, initialExchangeRate)
            const interest = simpleToExactAmount(10, 18)
            beforeEach(async () => {
                await createNewTokenLockerContract()
                await masset.approve(tokenLocker.address, simpleToExactAmount(1, 21))
                await tokenLocker.connect(alice.signer).lock(deposit)
            })
            afterEach(async () => {
                const data = await getData(tokenLocker, alice)
                expect(exchangeRateHolds(data), "Exchange rate must hold")
            })
            // test the balance calcs here.. credit to masset, and public calcs
            it("should redeem a specific amount of credits", async () => {
                // calculates underlying/credits
                const creditsToWithdraw = credits
                const expectedWithdrawal = creditsToUnderlying(creditsToWithdraw, initialExchangeRate)
                // console.log(`TS: amount ${deposit} , credits ${credits}, creditsToWithdraw ${creditsToWithdraw}, expectedWithdrawal ${expectedWithdrawal}`)
                // console.log(`TS: ---------------dataBefore--------------`)
                const dataBefore = await getData(tokenLocker, alice)

                await increaseTime(SIX_MONTHS)

                // const tx = savingsContract.redeemCredits(creditsToWithdraw)
                const tx = tokenLocker.connect(alice.signer).withdraw()
                await expect(tx).to.emit(tokenLocker, "Withdraw").withArgs(alice.address, expectedWithdrawal)
                await expect(tx).to.emit(savingsContract, "CreditsRedeemed").withArgs(tokenLocker.address, creditsToWithdraw, expectedWithdrawal)
                // await tx.wait()
                // console.log(`TS: ---------------dataAfter--------------`)
                const dataAfter = await getData(tokenLocker, alice)
                // burns credits from sender
                expect(dataAfter.balances.lockerCredits, "lockerCredits credits").eq(dataBefore.balances.lockerCredits.sub(creditsToWithdraw))
                // expect(dataAfter.balances.userCredits, "user credits").eq(dataBefore.balances.userCredits.sub(creditsToWithdraw))
                expect(dataAfter.balances.totalCredits, "total credits").eq(dataBefore.balances.totalCredits.sub(creditsToWithdraw))
                // transfers tokens to sender
                expect(dataAfter.balances.user, "user balance").eq(dataBefore.balances.user.add(expectedWithdrawal))
                // expect(dataAfter.balances.contract, "contract balance").eq(dataBefore.balances.contract.sub(expectedWithdrawal))
                expect(dataAfter.balances.lockerContract, "lockerContract balance").eq(dataBefore.balances.lockerContract.sub(expectedWithdrawal))

            })
            it("collects interest and credits to saver before redemption", async () => {
                const expectedExchangeRate = simpleToExactAmount(2, 17)
                await masset.setAmountForCollectInterest(interest)
                const dataBefore = await getData(tokenLocker, alice)
                await increaseTime(SIX_MONTHS)

                await tokenLocker.connect(alice.signer).withdraw()
                const dataAfter = await getData(tokenLocker, alice)
                expect(dataAfter.balances.totalCredits).eq(BN.from(0))
                // User receives their deposit back + interest
                assertBNClose(dataAfter.balances.user, dataBefore.balances.user.add(deposit).add(interest), 100)
                // Exchange rate updates
                expect(dataAfter.exchangeRate).eq(expectedExchangeRate)
            })
        })
        context.skip("using redeemUnderlying", async () => {
            const deposit = simpleToExactAmount(10, 18)
            const interest = simpleToExactAmount(10, 18)
            beforeEach(async () => {
                await createNewTokenLockerContract()
                await masset.approve(savingsContract.address, simpleToExactAmount(1, 21))
                await savingsContract.preDeposit(deposit, alice.address)
            })
            afterEach(async () => {
                const data = await getData(tokenLocker, alice)
                expect(exchangeRateHolds(data), "Exchange rate must hold")
            })
            it.skip("allows full redemption immediately after deposit", async () => {
                await savingsContract.redeemUnderlying(deposit)
                const data = await getData(tokenLocker, alice)
                expect(data.balances.userCredits).eq(BN.from(0))
            })
            it.skip("should redeem a specific amount of underlying", async () => {
                // calculates underlying/credits
                const underlying = simpleToExactAmount(5, 18)
                const expectedCredits = underlyingToCredits(underlying, initialExchangeRate)
                const dataBefore = await getData(tokenLocker, alice)
                const tx = savingsContract.redeemUnderlying(underlying)
                await expect(tx).to.emit(savingsContract, "CreditsRedeemed").withArgs(alice.address, expectedCredits, underlying)
                const dataAfter = await getData(tokenLocker, alice)
                // burns credits from sender
                expect(dataAfter.balances.userCredits).eq(dataBefore.balances.userCredits.sub(expectedCredits))
                expect(dataAfter.balances.totalCredits).eq(dataBefore.balances.totalCredits.sub(expectedCredits))
                // transfers tokens to sender
                expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(underlying))
                expect(dataAfter.balances.contract).eq(dataBefore.balances.contract.sub(underlying))
            })
            it.skip("collects interest and credits to saver before redemption", async () => {
                const expectedExchangeRate = simpleToExactAmount(2, 17)
                await masset.setAmountForCollectInterest(interest)

                const dataBefore = await getData(tokenLocker, alice)
                await savingsContract.redeemUnderlying(deposit)
                const dataAfter = await getData(tokenLocker, alice)

                expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(deposit))
                // User is left with resulting credits due to exchange rate going up
                assertBNClose(dataAfter.balances.userCredits, dataBefore.balances.userCredits.div(2), 1000)
                // Exchange rate updates
                expect(dataAfter.exchangeRate).eq(expectedExchangeRate)
            })
            it.skip("skips interest collection if automate is turned off", async () => {
                await masset.setAmountForCollectInterest(interest)
                await savingsContract.connect(sa.governor.signer).automateInterestCollectionFlag(false)

                const dataBefore = await getData(tokenLocker, alice)
                await savingsContract.redeemUnderlying(deposit)
                const dataAfter = await getData(tokenLocker, alice)

                expect(dataAfter.balances.user).eq(dataBefore.balances.user.add(deposit))
                expect(dataAfter.balances.userCredits).eq(BN.from(0))
                expect(dataAfter.exchangeRate).eq(dataBefore.exchangeRate)
            })
        })
    })
})