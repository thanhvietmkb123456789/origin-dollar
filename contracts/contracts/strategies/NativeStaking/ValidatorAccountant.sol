// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { ValidatorRegistrator } from "./ValidatorRegistrator.sol";
import { IWETH9 } from "../../interfaces/IWETH9.sol";

/// @title Validator Accountant
/// @notice Attributes the ETH swept from beacon chain validators to this strategy contract
/// as either full or partial withdrawals. Partial withdrawals being consensus rewards.
/// Full withdrawals are from exited validators.
/// @author Origin Protocol Inc
abstract contract ValidatorAccountant is ValidatorRegistrator {
    /// @notice The maximum amount of ETH that can be staked by a validator
    /// @dev this can change in the future with EIP-7251, Increase the MAX_EFFECTIVE_BALANCE
    uint256 public constant MAX_STAKE = 32 ether;

    /// @notice Keeps track of the total consensus rewards swept from the beacon chain
    uint256 public consensusRewards = 0;

    /// @notice start of fuse interval
    uint256 public fuseIntervalStart = 0;
    /// @notice end of fuse interval
    uint256 public fuseIntervalEnd = 0;

    uint256[50] private __gap;

    event FuseIntervalUpdated(uint256 start, uint256 end);
    event AccountingFullyWithdrawnValidator(
        uint256 noOfValidators,
        uint256 remainingValidators,
        uint256 wethSentToVault
    );
    event AccountingValidatorSlashed(
        uint256 remainingValidators,
        uint256 wethSentToVault
    );
    event AccountingConsensusRewards(uint256 amount);

    event AccountingManuallyFixed(
        int256 validatorsDelta,
        int256 consensusRewardsDelta,
        uint256 wethToVault
    );

    /// @param _wethAddress Address of the Erc20 WETH Token contract
    /// @param _vaultAddress Address of the Vault
    /// @param _beaconChainDepositContract Address of the beacon chain deposit contract
    /// @param _ssvNetwork Address of the SSV Network contract
    constructor(
        address _wethAddress,
        address _vaultAddress,
        address _beaconChainDepositContract,
        address _ssvNetwork
    )
        ValidatorRegistrator(
            _wethAddress,
            _vaultAddress,
            _beaconChainDepositContract,
            _ssvNetwork
        )
    {}

    /// @notice set fuse interval values
    function setFuseInterval(
        uint256 _fuseIntervalStart,
        uint256 _fuseIntervalEnd
    ) external onlyGovernor {
        require(
            _fuseIntervalStart < _fuseIntervalEnd &&
                _fuseIntervalStart < 32 ether &&
                _fuseIntervalEnd < 32 ether &&
                _fuseIntervalEnd - _fuseIntervalStart >= 4 ether,
            "incorrect fuse interval"
        );

        emit FuseIntervalUpdated(_fuseIntervalStart, _fuseIntervalEnd);

        fuseIntervalStart = _fuseIntervalStart;
        fuseIntervalEnd = _fuseIntervalEnd;
    }

    /* solhint-disable max-line-length */
    /// This notion page offers a good explanation of how the accounting functions
    /// https://www.notion.so/originprotocol/Limited-simplified-native-staking-accounting-67a217c8420d40678eb943b9da0ee77d
    /// In short, after dividing by 32, if the ETH remaining on the contract falls between 0 and fuseIntervalStart,
    /// the accounting function will treat that ETH as Beacon chain consensus rewards.
    /// On the contrary, if after dividing by 32, the ETH remaining on the contract falls between fuseIntervalEnd and 32,
    /// the accounting function will treat that as a validator slashing.
    /// @notice Perform the accounting attributing beacon chain ETH to either full or partial withdrawals. Returns true when
    /// accounting is valid and fuse isn't "blown". Returns false when fuse is blown.
    /// @dev This function could in theory be permission-less but lets allow only the Registrator (Defender Action) to call it
    /// for now.
    /// @return accountingValid true if accounting was successful, false if fuse is blown
    /* solhint-enable max-line-length */
    function doAccounting()
        external
        onlyRegistrator
        whenNotPaused
        returns (bool accountingValid)
    {
        // pause the accounting on failure
        accountingValid = _doAccounting(true);
    }

    function _doAccounting(bool pauseOnFail)
        internal
        returns (bool accountingValid)
    {
        if (address(this).balance < consensusRewards) {
            return _failAccounting(pauseOnFail);
        }

        // Calculate all the new ETH that has been swept to the contract since the last accounting
        uint256 newSweptETH = address(this).balance - consensusRewards;
        accountingValid = true;

        // send the ETH that is from fully withdrawn validators to the Vault
        if (newSweptETH >= MAX_STAKE) {
            uint256 fullyWithdrawnValidators = newSweptETH / MAX_STAKE;
            if (activeDepositedValidators < fullyWithdrawnValidators) {
                return _failAccounting(pauseOnFail);
            }
            activeDepositedValidators -= fullyWithdrawnValidators;

            uint256 wethToVault = MAX_STAKE * fullyWithdrawnValidators;
            IWETH9(WETH_TOKEN_ADDRESS).deposit{ value: wethToVault }();
            IWETH9(WETH_TOKEN_ADDRESS).transfer(VAULT_ADDRESS, wethToVault);

            emit AccountingFullyWithdrawnValidator(
                fullyWithdrawnValidators,
                activeDepositedValidators,
                wethToVault
            );
        }

        uint256 ethRemaining = address(this).balance - consensusRewards;
        // should be less than a whole validator stake
        require(ethRemaining < 32 ether, "unexpected accounting");

        // If no Beacon chain consensus rewards swept
        if (ethRemaining == 0) {
            // do nothing
            return accountingValid;
        }
        // Beacon chain consensus rewards swept (partial validator withdrawals)
        else if (ethRemaining < fuseIntervalStart) {
            // solhint-disable-next-line reentrancy
            consensusRewards += ethRemaining;
            emit AccountingConsensusRewards(ethRemaining);
        }
        // Beacon chain consensus rewards swept but also a slashed validator fully exited
        else if (ethRemaining > fuseIntervalEnd) {
            IWETH9(WETH_TOKEN_ADDRESS).deposit{ value: ethRemaining }();
            IWETH9(WETH_TOKEN_ADDRESS).transfer(VAULT_ADDRESS, ethRemaining);
            activeDepositedValidators -= 1;

            emit AccountingValidatorSlashed(
                activeDepositedValidators,
                ethRemaining
            );
        }
        // Oh no... Fuse is blown. The Strategist needs to adjust the accounting values.
        else {
            return _failAccounting(pauseOnFail);
        }
    }

    /// @dev pause any further accounting if required and return false
    function _failAccounting(bool pauseOnFail)
        internal
        returns (bool accountingValid)
    {
        // pause if not already
        if (pauseOnFail) {
            _pause();
        }
        // fail the accounting
        accountingValid = false;
    }

    /// @notice Allow the Strategist to fix the accounting of this strategy and unpause.
    /// @param _validatorsDelta adjust the active validators by plus one, minus one or unchanged with zero
    /// @param _wethToVaultAmount the amount of WETH to be sent to the Vault
    /// @param _consensusRewardsDelta adjust the accounted for consensus rewards up or down
    function manuallyFixAccounting(
        int256 _validatorsDelta,
        int256 _consensusRewardsDelta,
        uint256 _wethToVaultAmount
    ) external onlyStrategist whenPaused {
        require(
            _validatorsDelta >= -3 &&
                _validatorsDelta <= 3 &&
                // new value must be positive
                int256(activeDepositedValidators) + _validatorsDelta >= 0,
            "invalid validatorsDelta"
        );
        require(
            _consensusRewardsDelta >= -332 ether &&
                _consensusRewardsDelta <= 332 ether &&
                // new value must be positive
                int256(consensusRewards) + _consensusRewardsDelta >= 0,
            "invalid consensusRewardsDelta"
        );
        require(_wethToVaultAmount <= 32 ether, "invalid wethToVaultAmount");

        emit AccountingManuallyFixed(
            _validatorsDelta,
            _consensusRewardsDelta,
            _wethToVaultAmount
        );

        activeDepositedValidators = uint256(
            int256(activeDepositedValidators) + _validatorsDelta
        );
        consensusRewards = uint256(
            int256(consensusRewards) + _consensusRewardsDelta
        );
        if (_wethToVaultAmount > 0) {
            IWETH9(WETH_TOKEN_ADDRESS).transfer(
                VAULT_ADDRESS,
                _wethToVaultAmount
            );
        }

        // rerun the accounting to see if it has now been fixed.
        // Do not pause the accounting on failure as it is already paused
        require(_doAccounting(false), "fuse still blown");

        // unpause since doAccounting was successful
        _unpause();
    }
}