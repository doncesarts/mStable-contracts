// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;


interface ITokenLocker {

    /**
     * @dev Locks an amount of ERC20 Token for `getDuration()` period of time.
     * @param _amount Units of mAsset to lock.
     */
    function lock(uint256 _amount) external returns (uint256 creditsIssued);

    /**
     * @dev Withdraws all the senders (principle + interest), providing lockup is over
     * Withdrawals via `witdraw` function will not be possible until the lockup has finished `getDuration()`
     */
    function withdraw() external;

    /**
     * @dev Gets the duration of the locking period.
     */
    function getDuration() external pure returns (uint256);

    function batchExecute() external returns (uint256);


}