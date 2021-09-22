// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
import { ITokenLocker } from "../interfaces/ITokenLocker.sol";
import { ISavingsContractV2 } from "../interfaces/ISavingsContract.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title  TokenLocker
 * @author doncesarts
 * @notice Lockup mAsset, receive imAsset
 * @dev    Supports:
 *            1) Tracking ERC20 Locked up (LockedBalance)
 *            2) Allows users to deposit an amount of ERC20 into the contract via a `lock` function.
 *            3) TokenLocker deposits saved funds into the mStable `SavingsContract`
 *            4) Withdrawals via `witdraw` function will not be possible until the lockup has finished (6 months)
 *            5) Invoking `witdraw()` after the lockig period, allows to user receives back principle + interest
 */
contract TokenLocker is ITokenLocker, ReentrancyGuard {
    using SafeERC20 for IERC20;
    /// @notice Core token that is locked and tracked (e.g. MTA)
    IERC20 public immutable LOCKED_TOKEN;
    ISavingsContractV2 public immutable SAVINGS_CONTRACT;
    uint256 private constant LOCKUP_PERIOD = 24 weeks;
    uint256 public batchThreshold = 10000;
    bool public isBatchEnable = false;

    // Structs
    struct LockedBalance {
        uint256 amount;
        uint256 credits;
        uint256 end;
        bool locked;
        bool exist;
    }
    mapping(address => LockedBalance) public lockedBalances;
    address[] private addressIndices;

    // Events
    event Locked(address indexed user, uint256 amount, uint256 releaseTime);
    event Withdraw(address indexed user, uint256 amount);

    /***************************************
                    INIT
    ****************************************/
    constructor(address _lockedToken, address _save) {
        require(address(_lockedToken) != address(0), "Locker: mAsset address is zero");
        require(address(_save) != address(0), "Locker: SavingContract address is zero");
        LOCKED_TOKEN = IERC20(_lockedToken);
        SAVINGS_CONTRACT = ISavingsContractV2(_save);
    }

    /**
     * @dev Locks an amount of ERC20 Token for `getDuration()` period of time.
     * @param _amount Units of mAsset to lock.
     */
    function lock(uint256 _amount) external override nonReentrant returns (uint256 creditsIssued) {
        return _transferAndLock(msg.sender, _amount, block.timestamp + LOCKUP_PERIOD);
    }

    /**
     * @dev Deposits into "SavingsContract"
     * @param _amount Units of mAsset to lock.
     */
    function _depositSavings(uint256 _amount) internal returns (uint256 creditsIssued) {
        require(_amount > 0, "Locker: Must lock non zero amount");
        // update all non locked users 
        if (isBatchEnable) {
            for (uint256 i = 0; i < addressIndices.length; i++) {
                if (!lockedBalances[addressIndices[i]].locked) {
                    lockedBalances[addressIndices[i]].locked = true;
                }
            }
        }
        LOCKED_TOKEN.safeApprove(address(SAVINGS_CONTRACT), _amount);
        uint256 credits = SAVINGS_CONTRACT.depositSavings(_amount, address(this));
        return credits;
    }

    /**
     * @dev Locks an amount of ERC20 Token for `getDuration()` period of time.
     * @param _addr User address.
     * @param _amount Units of mAsset to lock.
     * @param _unlockTime Time at which the stake should unlock
     */
    function _transferAndLock(
        address _addr,
        uint256 _amount,
        uint256 _unlockTime
    ) internal returns (uint256 creditsIssued) {
        require(address(_addr) != address(0), "Locker: Invalid beneficiary address");
        require(_amount > 0, "Locker: Must lock non zero amount");
        require(_unlockTime > block.timestamp, "Locker: Can only lock until time in the future");

        // Transfer token to Locker
        LOCKED_TOKEN.safeTransferFrom(_addr, address(this), _amount);

        // Deposit amount into SavingsContract
        uint256 credits = 0;
        bool locked = false;
        if (!isBatchEnable) {
            credits = _depositSavings(_amount);
            locked = true;
        } else {
            credits = SAVINGS_CONTRACT.underlyingToCredits(_amount);
        }

        LockedBalance memory lockedBalance;

        // Verify if user is new
        if (!lockedBalances[_addr].exist) {
            addressIndices.push(_addr);
        }
        // Verify if user has a previous lock
        if (lockedBalances[_addr].amount > 0) {
            uint256 unlockTime = lockedBalances[_addr].end;
            //  If previous lock has expired, update  unlock time
            if (unlockTime < block.timestamp) {
                unlockTime = _unlockTime;
            }

            lockedBalance = LockedBalance({
                amount: lockedBalances[_addr].amount + _amount,
                credits: lockedBalances[_addr].credits + credits,
                end: unlockTime,
                locked: locked,
                exist: true
            });
        } else {
            lockedBalance = LockedBalance({
                amount: _amount,
                credits: credits,
                end: _unlockTime,
                locked: locked,
                exist: true
            });
        }

        lockedBalances[_addr] = lockedBalance;
        emit Locked(_addr, _amount, _unlockTime);
        return credits;
    }

    /**
     * @dev Withdraws all the senders (principle + interest), providing lockup is over
     */
    function withdraw() external override nonReentrant {
        _withdraw(msg.sender);
    }

    /**
     * @dev Withdraws all the senders (principle + interest), providing lockup is over.
     * @param _addr User address.
     */
    function _withdraw(address _addr) internal {
        LockedBalance storage lockedBalance = lockedBalances[_addr];
        require(lockedBalance.amount > 0, "Locker: Must have something to withdraw");
        require(lockedBalance.end <= block.timestamp, "Locker: Lock period didn't expire");
        require(lockedBalance.credits > 0, "Locker: Must have something to withdraw");
        require(lockedBalance.locked, "Locker: Not yet locked");

        // uint256 amount = lockedBalance.amount;
        uint256 credits = lockedBalance.credits;

        lockedBalance.amount = 0;
        lockedBalance.credits = 0;

        // uint256 massetReturned = SAVINGS_CONTRACT.redeem(amount);
        // LOCKED_TOKEN.safeApprove(address(SAVINGS_CONTRACT), underlyingReturned);

        uint256 underlyingReturned = SAVINGS_CONTRACT.redeemCredits(credits);
        LOCKED_TOKEN.safeTransfer(_addr, underlyingReturned);
        emit Withdraw(_addr, underlyingReturned);

        // uint256 creditsBurned = SAVINGS_CONTRACT.redeemUnderlying(amount);
        // console.log("SOL::_withdraw amount %s , credits %s , creditsBurned %s", amount, credits, creditsBurned);
        // LOCKED_TOKEN.safeTransfer(_addr, amount);
        // emit Withdraw(_addr, amount);
    }

    function balanceOf(address _addr) public view returns (uint256) {
        return lockedBalances[_addr].amount;
    }

    /**
     * @dev Gets the duration of the locking period.
     */
    function getDuration() external pure override returns (uint256) {
        return LOCKUP_PERIOD;
    }

    function batchExecute() external override nonReentrant returns (uint256) {
        require(isBatchEnable, "Locker: Batch mode is not enable");
        require(
            LOCKED_TOKEN.balanceOf(address(this)) >= batchThreshold,
            "Locker: Batch amount insufficient"
        );
        return _depositSavings(LOCKED_TOKEN.balanceOf(address(this)));
    }

    function setBatchEnable(bool _isBatchEnable) external {
        isBatchEnable = _isBatchEnable;
    }
}
