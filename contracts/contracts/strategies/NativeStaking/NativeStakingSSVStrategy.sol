// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { InitializableAbstractStrategy } from "../../utils/InitializableAbstractStrategy.sol";
import { IWETH9 } from "../../interfaces/IWETH9.sol";
import { FeeAccumulator } from "./FeeAccumulator.sol";
import { ValidatorAccountant } from "./ValidatorAccountant.sol";

struct ValidatorStakeData {
    bytes pubkey;
    bytes signature;
    bytes32 depositDataRoot;
}

/// @title Native Staking SSV Strategy
/// @notice Strategy to deploy funds into DVT validators powered by the SSV Network
/// @author Origin Protocol Inc
contract NativeStakingSSVStrategy is
    ValidatorAccountant,
    InitializableAbstractStrategy
{
    using SafeERC20 for IERC20;

    /// @notice SSV ERC20 token that serves as a payment for operating SSV validators
    address public immutable SSV_TOKEN_ADDRESS;
    /// @notice Fee collector address
    /// @dev this address will receive Execution layer rewards - These are rewards earned for
    /// executing transactions on the Ethereum network as part of block proposals. They include
    /// priority fees (fees paid by users for their transactions to be included) and MEV rewards
    /// (rewards for arranging transactions in a way that benefits the validator).
    address public immutable FEE_ACCUMULATOR_ADDRESS;

    // For future use
    uint256[50] private __gap;

    /// @param _baseConfig Base strategy config with platformAddress (ERC-4626 Vault contract), eg sfrxETH or sDAI,
    /// and vaultAddress (OToken Vault contract), eg VaultProxy or OETHVaultProxy
    /// @param _wethAddress Address of the Erc20 WETH Token contract
    /// @param _ssvToken Address of the Erc20 SSV Token contract
    /// @param _ssvNetwork Address of the SSV Network contract
    /// @param _feeAccumulator Address of the fee accumulator receiving execution layer validator rewards
    /// @param _beaconChainDepositContract Address of the beacon chain deposit contract
    constructor(
        BaseStrategyConfig memory _baseConfig,
        address _wethAddress,
        address _ssvToken,
        address _ssvNetwork,
        address _feeAccumulator,
        address _beaconChainDepositContract
    )
        InitializableAbstractStrategy(_baseConfig)
        ValidatorAccountant(
            _wethAddress,
            _baseConfig.vaultAddress,
            _beaconChainDepositContract,
            _ssvNetwork
        )
    {
        SSV_TOKEN_ADDRESS = _ssvToken;
        FEE_ACCUMULATOR_ADDRESS = _feeAccumulator;
    }

    /// @notice initialize function, to set up initial internal state
    /// @param _rewardTokenAddresses Address of reward token for platform
    /// @param _assets Addresses of initial supported assets
    /// @param _pTokens Platform Token corresponding addresses
    function initialize(
        address[] memory _rewardTokenAddresses,
        address[] memory _assets,
        address[] memory _pTokens
    ) external onlyGovernor initializer {
        InitializableAbstractStrategy._initialize(
            _rewardTokenAddresses,
            _assets,
            _pTokens
        );
    }

    /// @dev Convert accumulated ETH to WETH and send to the Harvester.
    /// Will revert if the strategy is paused for accounting.
    function _collectRewardTokens() internal override whenNotPaused {
        // collect ETH from execution rewards from the fee accumulator
        uint256 executionRewards = FeeAccumulator(FEE_ACCUMULATOR_ADDRESS)
            .collect();

        // total ETH rewards to be harvested = execution rewards + consensus rewards
        uint256 ethRewards = executionRewards + consensusRewards;

        require(
            address(this).balance >= ethRewards,
            "insufficient eth balance"
        );

        if (ethRewards > 0) {
            // reset the counter keeping track of beacon chain consensus rewards
            consensusRewards = 0;

            // Convert ETH rewards to WETH
            IWETH9(WETH_TOKEN_ADDRESS).deposit{ value: ethRewards }();

            emit RewardTokenCollected(
                harvesterAddress,
                WETH_TOKEN_ADDRESS,
                ethRewards
            );
            IERC20(WETH_TOKEN_ADDRESS).safeTransfer(
                harvesterAddress,
                ethRewards
            );
        }
    }

    /// @notice Unlike other strategies, this does not deposit assets into the underlying platform.
    /// It just checks the asset is WETH and emits the Deposit event.
    /// To deposit WETH into validators `registerSsvValidator` and `stakeEth` must be used.
    /// Will NOT revert if the strategy is paused from an accounting failure.
    /// @param _asset Address of asset to deposit. Has to be WETH.
    /// @param _amount Amount of assets that were transferred to the strategy by the vault.
    function deposit(address _asset, uint256 _amount)
        external
        override
        onlyVault
        nonReentrant
    {
        require(_asset == WETH_TOKEN_ADDRESS, "Unsupported asset");
        _deposit(_asset, _amount);
    }

    /// @dev Deposit WETH to this strategy so it can later be staked into a validator.
    /// @param _asset Address of WETH
    /// @param _amount Amount of WETH to deposit
    function _deposit(address _asset, uint256 _amount) internal {
        require(_amount > 0, "Must deposit something");
        /*
         * We could do a check here that would revert when "_amount % 32 ether != 0". With the idea of
         * not allowing deposits that will result in WETH sitting on the strategy after all the possible batches
         * of 32ETH have been staked.
         * But someone could mess with our strategy by sending some WETH to it. And we might want to deposit just
         * enough WETH to add it up to 32 so it can be staked. For that reason the check is left out.
         *
         * WETH sitting on the strategy won't interfere with the accounting since accounting only operates on ETH.
         */
        emit Deposit(_asset, address(0), _amount);
    }

    /// @notice Unlike other strategies, this does not deposit assets into the underlying platform.
    /// It just emits the Deposit event.
    /// To deposit WETH into validators `registerSsvValidator` and `stakeEth` must be used.
    /// Will NOT revert if the strategy is paused from an accounting failure.
    function depositAll() external override onlyVault nonReentrant {
        uint256 wethBalance = IERC20(WETH_TOKEN_ADDRESS).balanceOf(
            address(this)
        );
        if (wethBalance > 0) {
            _deposit(WETH_TOKEN_ADDRESS, wethBalance);
        }
    }

    /// @notice Withdraw WETH from this contract. Used only if some WETH for is lingering on the contract. That
    /// can happen when:
    ///   - the deposit was not a multiple of 32 WETH
    ///   - someone sent WETH directly to this contract
    /// Will NOT revert if the strategy is paused from an accounting failure.
    /// @param _recipient Address to receive withdrawn assets
    /// @param _asset WETH to withdraw
    /// @param _amount Amount of WETH to withdraw
    function withdraw(
        address _recipient,
        address _asset,
        uint256 _amount
    ) external override onlyVault nonReentrant {
        _withdraw(_recipient, _asset, _amount);
    }

    function _withdraw(
        address _recipient,
        address _asset,
        uint256 _amount
    ) internal {
        require(_amount > 0, "Must withdraw something");
        require(_recipient != address(0), "Must specify recipient");

        emit Withdrawal(_asset, address(0), _amount);
        IERC20(_asset).safeTransfer(_recipient, _amount);
    }

    /// @notice transfer all WETH deposits back to the vault.
    /// This does not withdraw from the validators. That has to be done separately with the
    /// `exitSsvValidator` and `removeSsvValidator` operations.
    /// This does not withdraw any execution rewards from the FeeAccumulator or
    /// consensus rewards in this strategy.
    /// Any ETH in this strategy that was swept from a full validator withdrawal will not be withdrawn.
    /// ETH from full validator withdrawals is sent to the Vault using `doAccounting`.
    /// Will NOT revert if the strategy is paused from an accounting failure.
    function withdrawAll() external override onlyVaultOrGovernor nonReentrant {
        uint256 wethBalance = IERC20(WETH_TOKEN_ADDRESS).balanceOf(
            address(this)
        );
        if (wethBalance > 0) {
            _withdraw(vaultAddress, WETH_TOKEN_ADDRESS, wethBalance);
        }
    }

    function _abstractSetPToken(address _asset, address) internal override {}

    /// @notice Returns the total value of (W)ETH that is staked to the validators
    /// and WETH deposits that are still to be staked.
    /// This does not include ETH from consensus rewards sitting in this strategy
    /// or ETH from MEV rewards in the FeeAccumulator. These rewards are harvested
    /// and sent to the Dripper so will eventually be sent to the Vault as WETH.
    /// @param _asset      Address of weth asset
    /// @return balance    Total value of (W)ETH
    function checkBalance(address _asset)
        external
        view
        override
        returns (uint256 balance)
    {
        require(_asset == WETH_TOKEN_ADDRESS, "Unsupported asset");

        balance =
            // add the ETH that has been staked in validators
            activeDepositedValidators *
            32 ether +
            // add the WETH in the strategy from deposits that are still to be staked
            IERC20(WETH_TOKEN_ADDRESS).balanceOf(address(this));
    }

    function pause() external onlyStrategist {
        _pause();
    }

    /// @notice Returns bool indicating whether asset is supported by strategy.
    /// @param _asset The address of the asset token.
    function supportsAsset(address _asset) public view override returns (bool) {
        return _asset == WETH_TOKEN_ADDRESS;
    }

    /// @notice Approves the SSV Network contract to transfer SSV tokens for deposits
    function safeApproveAllTokens() external override {
        /// @dev Approves the SSV Network contract to transfer SSV tokens for deposits
        IERC20(SSV_TOKEN_ADDRESS).approve(
            SSV_NETWORK_ADDRESS,
            type(uint256).max
        );
    }

    /**
     * @notice Only accept ETH from the FeeAccumulator and the WETH contract - required when
     * unwrapping WETH just before staking it to the validator
     * @dev don't want to receive donations from anyone else as this will
     * mess with the accounting of the consensus rewards and validator full withdrawals
     */
    receive() external payable {
        require(
            msg.sender == FEE_ACCUMULATOR_ADDRESS ||
                msg.sender == WETH_TOKEN_ADDRESS,
            "eth not from allowed contracts"
        );
    }
}