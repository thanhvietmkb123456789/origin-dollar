// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title OETH Balancer MetaStablePool Strategy
 * @author Origin Protocol Inc
 */
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { BaseAuraStrategy, BaseBalancerStrategy } from "./BaseAuraStrategy.sol";
import { IBalancerVault } from "../../interfaces/balancer/IBalancerVault.sol";
import { IRateProvider } from "../../interfaces/balancer/IRateProvider.sol";
import { IMetaStablePool } from "../../interfaces/balancer/IMetaStablePool.sol";
import { IERC20, InitializableAbstractStrategy } from "../../utils/InitializableAbstractStrategy.sol";
import { StableMath } from "../../utils/StableMath.sol";

contract BalancerMetaPoolStrategy is BaseAuraStrategy {
    using SafeERC20 for IERC20;
    using StableMath for uint256;

    constructor(
        BaseStrategyConfig memory _stratConfig,
        BaseBalancerConfig memory _balancerConfig,
        address _auraRewardPoolAddress
    )
        InitializableAbstractStrategy(_stratConfig)
        BaseBalancerStrategy(_balancerConfig)
        BaseAuraStrategy(_auraRewardPoolAddress)
    {}

    /**
     * @notice Deposits an `_amount` of vault collateral assets
     * from the this strategy contract to the Balancer pool.
     * @param _asset Address of the Vault collateral asset
     * @param _amount The amount of Vault collateral assets to deposit
     */
    function deposit(address _asset, uint256 _amount)
        external
        override
        onlyVault
        nonReentrant
    {
        address[] memory assets = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        assets[0] = _asset;
        amounts[0] = _amount;

        _deposit(assets, amounts);
    }

    /**
     * @notice Deposits specified vault collateral assets
     * from the this strategy contract to the Balancer pool.
     * @param _assets Address of the Vault collateral assets
     * @param _amounts The amount of each asset to deposit
     */
    function deposit(address[] memory _assets, uint256[] memory _amounts)
        external
        onlyVault
        nonReentrant
    {
        _deposit(_assets, _amounts);
    }

    /**
     * @notice Deposits all supported assets in this strategy contract to the Balancer pool.
     */
    function depositAll() external override onlyVault nonReentrant {
        uint256 assetsLength = assetsMapped.length;
        address[] memory assets = new address[](assetsLength);
        uint256[] memory amounts = new uint256[](assetsLength);

        // For each vault collateral asset
        for (uint256 i = 0; i < assetsLength; ++i) {
            assets[i] = assetsMapped[i];
            // Get the asset balance in this strategy contract
            amounts[i] = IERC20(assets[i]).balanceOf(address(this));
        }
        _deposit(assets, amounts);
    }

    function _deposit(address[] memory _assets, uint256[] memory _amounts)
        internal
    {
        require(_assets.length == _amounts.length, "Array length missmatch");

        (IERC20[] memory tokens, , ) = balancerVault.getPoolTokens(
            balancerPoolId
        );

        uint256[] memory mappedAmounts = new uint256[](tokens.length);
        address[] memory mappedAssets = new address[](tokens.length);

        for (uint256 i = 0; i < _assets.length; ++i) {
            address asset = _assets[i];
            uint256 amount = _amounts[i];

            require(assetToPToken[asset] != address(0), "Unsupported asset");
            mappedAssets[i] = toPoolAsset(_assets[i]);

            if (amount > 0) {
                emit Deposit(asset, platformAddress, amount);

                // wrap rebasing assets like stETH and frxETH to wstETH and sfrxETH
                (, mappedAmounts[i]) = wrapPoolAsset(asset, amount);
            }
        }

        uint256[] memory amountsIn = new uint256[](tokens.length);
        address[] memory poolAssets = new address[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            // Convert IERC20 type to address
            poolAssets[i] = address(tokens[i]);

            // For each of the mapped assets
            for (uint256 j = 0; j < mappedAssets.length; ++j) {
                // If the pool asset is the same as the mapped asset
                if (poolAssets[i] == mappedAssets[j]) {
                    amountsIn[i] = mappedAmounts[j];
                }
            }
        }

        uint256 minBPT = getBPTExpected(_assets, _amounts);
        uint256 minBPTwSlippage = minBPT.mulTruncate(1e18 - maxDepositSlippage);

        /* EXACT_TOKENS_IN_FOR_BPT_OUT:
         * User sends precise quantities of tokens, and receives an
         * estimated but unknown (computed at run time) quantity of BPT.
         *
         * ['uint256', 'uint256[]', 'uint256']
         * [EXACT_TOKENS_IN_FOR_BPT_OUT, amountsIn, minimumBPT]
         */
        bytes memory userData = abi.encode(
            IBalancerVault.WeightedPoolJoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT,
            amountsIn,
            minBPTwSlippage
        );

        IBalancerVault.JoinPoolRequest memory request = IBalancerVault
            .JoinPoolRequest(poolAssets, amountsIn, userData, false);

        // Add the pool assets in this strategy to the balancer pool
        balancerVault.joinPool(
            balancerPoolId,
            address(this),
            address(this),
            request
        );

        // Deposit the Balancer Pool Tokens (BPT) into Aura
        _lpDepositAll();
    }

    /**
     * @notice Withdraw a Vault collateral asset from the Balancer pool.
     * @param _recipient Address to receive the Vault collateral assets. Typically is the Vault.
     * @param _asset Address of the Vault collateral asset
     * @param _amount The amount of Vault collateral assets to withdraw
     */
    function withdraw(
        address _recipient,
        address _asset,
        uint256 _amount
    ) external override onlyVault nonReentrant {
        address[] memory assets = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        assets[0] = _asset;
        amounts[0] = _amount;

        _withdraw(_recipient, assets, amounts);
    }

    /**
     * @notice Withdraw multiple Vault collateral asset from the Balancer pool.
     * @param _recipient Address to receive the Vault collateral assets. Typically is the Vault.
     * @param _assets Addresses of the Vault collateral assets
     * @param _amounts The amounts of Vault collateral assets to withdraw
     */
    function withdraw(
        address _recipient,
        address[] memory _assets,
        uint256[] memory _amounts
    ) external onlyVault nonReentrant {
        _withdraw(_recipient, _assets, _amounts);
    }

    /**
     * @dev Withdraw multiple Vault collateral asset from the Balancer pool.
     * @param _recipient Address to receive the Vault collateral assets. Typically is the Vault.
     * @param _assets Addresses of the Vault collateral assets
     * @param _amounts The amounts of Vault collateral assets to withdraw
     */
    function _withdraw(
        address _recipient,
        address[] memory _assets,
        uint256[] memory _amounts
    ) internal {
        require(_assets.length == _amounts.length, "Invalid input arrays");

        // STEP 1 - Calculate the max about of Balancer Pool Tokens (BPT) to withdraw

        // Estimate the required amount of Balancer Pool Tokens (BPT) for the assets
        uint256 maxBPTtoWithdraw = getBPTExpected(_assets, _amounts);
        // Increase BPTs by the max allowed slippage
        // Any excess BPTs will be left in this strategy contract
        maxBPTtoWithdraw = maxBPTtoWithdraw.mulTruncate(
            1e18 + maxWithdrawalSlippage
        );

        // STEP 2  - Withdraw the Balancer Pool Tokens (BPT) from Aura to this strategy contract

        // Withdraw BPT from Aura allowing for BPTs left in this strategy contract from previous withdrawals
        _lpWithdraw(
            maxBPTtoWithdraw - IERC20(platformAddress).balanceOf(address(this))
        );

        // STEP 3 - Calculate the Balancer pool assets and amounts from the vault collateral assets

        // Get all the supported balancer pool assets
        (IERC20[] memory tokens, , ) = balancerVault.getPoolTokens(
            balancerPoolId
        );
        // Calculate the balancer pool assets and amounts to withdraw
        uint256[] memory poolAmountsOut = new uint256[](tokens.length);
        address[] memory poolAssets = new address[](tokens.length);
        // Is the wrapped asset amount indexed by the assets array, not the order of the Balancer pool tokens
        // eg wstETH and sfrxETH amounts, not the stETH and frxETH amounts
        uint256[] memory wrappedAssetAmounts = new uint256[](_assets.length);

        // For each of the Balancer pool assets
        for (uint256 i = 0; i < tokens.length; ++i) {
            poolAssets[i] = address(tokens[i]);

            // for each of the vault assets
            for (uint256 j = 0; j < _assets.length; ++j) {
                // Convert the Balancer pool asset back to a vault collateral asset
                address vaultAsset = fromPoolAsset(poolAssets[i]);

                // If the vault asset equals the vault asset mapped from the Balancer pool asset
                if (_assets[j] == vaultAsset) {
                    (, poolAmountsOut[i]) = toPoolAsset(
                        vaultAsset,
                        _amounts[j]
                    );
                    wrappedAssetAmounts[j] = poolAmountsOut[i];

                    /* Because of the potential Balancer rounding error mentioned below
                     * the contract might receive 1-2 WEI smaller amount than required
                     * in the withdraw user data encoding. If slightly lesser token amount
                     * is received the strategy can not unwrap the pool asset as it is
                     * smaller than expected.
                     *
                     * For that reason we `overshoot` the required tokens expected to
                     * circumvent the error
                     */
                    if (poolAmountsOut[i] > 0) {
                        poolAmountsOut[i] += 2;
                    }
                }
            }
        }

        // STEP 4 - Withdraw the balancer pool assets from the pool

        /* Custom asset exit: BPT_IN_FOR_EXACT_TOKENS_OUT:
         * User sends an estimated but unknown (computed at run time) quantity of BPT,
         * and receives precise quantities of specified tokens.
         *
         * ['uint256', 'uint256[]', 'uint256']
         * [BPT_IN_FOR_EXACT_TOKENS_OUT, amountsOut, maxBPTAmountIn]
         */
        bytes memory userData = abi.encode(
            IBalancerVault.WeightedPoolExitKind.BPT_IN_FOR_EXACT_TOKENS_OUT,
            poolAmountsOut,
            maxBPTtoWithdraw
        );

        IBalancerVault.ExitPoolRequest memory request = IBalancerVault
            .ExitPoolRequest(
                poolAssets,
                /* We specify the exact amount of a tokens we are expecting in the encoded
                 * userData, for that reason we don't need to specify the amountsOut here.
                 *
                 * Also Balancer has a rounding issue that can make a transaction fail:
                 * https://github.com/balancer/balancer-v2-monorepo/issues/2541
                 * which is an extra reason why this field is empty.
                 */
                new uint256[](tokens.length),
                userData,
                false
            );

        balancerVault.exitPool(
            balancerPoolId,
            address(this),
            // TODO: this is incorrect and should be altered when/if we intend to support
            // pools that deal with native ETH
            payable(address(this)),
            request
        );

        // STEP 5 - Re-deposit any left over BPT tokens back into Aura
        /* When concluding how much of BPT we need to withdraw from Aura we rely on Oracle prices
         * and those can be stale (most ETH based have 24 hour heartbeat & 2% price change trigger)
         * After exiting the pool strategy could have left over BPT tokens that are not earning
         * boosted yield. We re-deploy those back in.
         */
        _lpDepositAll();

        // STEP 6 - Unswap balancer pool assets to vault collateral assets and sent to the vault.

        // For each of the specified assets
        for (uint256 i = 0; i < _assets.length; ++i) {
            // Unwrap assets like wstETH and sfrxETH to rebasing assets stETH and frxETH
            uint256 assetAmount = 0;
            if (wrappedAssetAmounts[i] > 0) {
                assetAmount = unwrapPoolAsset(
                    _assets[i],
                    wrappedAssetAmounts[i]
                );
            }

            // Transfer the vault collateral assets to the recipient, which is typically the vault
            if (_amounts[i] > 0) {
                IERC20(_assets[i]).safeTransfer(_recipient, _amounts[i]);

                emit Withdrawal(_assets[i], platformAddress, _amounts[i]);
            }
        }
    }

    /**
     * @notice Withdraws all supported Vault collateral assets from the Balancer pool
     * and send to the OToken's Vault.
     *
     * Is only executable by the OToken's Vault or the Governor.
     */
    function withdrawAll() external override onlyVaultOrGovernor nonReentrant {
        // STEP 1 - Withdraw all Balancer Pool Tokens (BPT) from Aura to this strategy contract

        _lpWithdrawAll();

        // STEP 2 - Calculate the minumum amount of pool assets to accept for the BPTs

        // Get the BPTs withdrawn from Aura plus any that were already in this strategy contract
        uint256 BPTtoWithdraw = IERC20(platformAddress).balanceOf(
            address(this)
        );

        // Get the balancer pool assets and their total balances
        (IERC20[] memory tokens, uint256[] memory balances, ) = balancerVault
            .getPoolTokens(balancerPoolId);

        // the strategy's share of the pool assets
        uint256 strategyShare = BPTtoWithdraw.divPrecisely(
            IERC20(platformAddress).totalSupply()
        );

        uint256[] memory minAmountsOut = new uint256[](tokens.length);
        address[] memory poolAssets = new address[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            poolAssets[i] = address(tokens[i]);
            minAmountsOut[i] = balances[i]
                .mulTruncate(strategyShare)
                .mulTruncate(1e18 - maxWithdrawalSlippage);
        }

        // STEP 3 - Withdraw the Balancer pool assets from the pool

        /* Proportional exit: EXACT_BPT_IN_FOR_TOKENS_OUT:
         * User sends a precise quantity of BPT, and receives an estimated but unknown
         * (computed at run time) quantity of a single token
         *
         * ['uint256', 'uint256']
         * [EXACT_BPT_IN_FOR_TOKENS_OUT, bptAmountIn]
         */
        bytes memory userData = abi.encode(
            IBalancerVault.WeightedPoolExitKind.EXACT_BPT_IN_FOR_TOKENS_OUT,
            BPTtoWithdraw
        );

        IBalancerVault.ExitPoolRequest memory request = IBalancerVault
            .ExitPoolRequest(poolAssets, minAmountsOut, userData, false);

        balancerVault.exitPool(
            balancerPoolId,
            address(this),
            // TODO: this is incorrect and should be altered when/if we intend to support
            // pools that deal with native ETH
            payable(address(this)),
            request
        );

        // STEP 4 - Convert the balancer pool assets to the vault collateral assets and send to the vault

        // For each of the Balancer pool assets
        for (uint256 i = 0; i < tokens.length; ++i) {
            address poolAsset = address(tokens[i]);
            // Convert the balancer pool asset to the vault collateral asset
            address asset = fromPoolAsset(poolAsset);
            // Get the balancer pool assets withdraw from the pool plus any that were already in this strategy contract
            uint256 poolAssetAmount = IERC20(poolAsset).balanceOf(
                address(this)
            );

            // Unwrap assets like wstETH and sfrxETH to rebasing assets stETH and frxETH
            uint256 assetAmount = 0;
            if (poolAssetAmount > 0) {
                assetAmount = unwrapPoolAsset(asset, poolAssetAmount);
            }

            // Transfer the vault collateral assets to the vault
            if (assetAmount > 0) {
                IERC20(asset).safeTransfer(vaultAddress, assetAmount);
                emit Withdrawal(asset, platformAddress, assetAmount);
            }
        }
    }

    /**
     * @notice Approves the Balancer pool to transfer all supported
     * assets from this strategy.
     * Also approve any suppered assets that are wrapped in the Balancer pool
     * like stETH and frxETH, to be transferred from this strategy to their
     * respective wrapper contracts. eg wstETH and sfrxETH.
     *
     * Is only executable by the Governor.
     */
    function safeApproveAllTokens()
        external
        override
        onlyGovernor
        nonReentrant
    {
        uint256 assetCount = assetsMapped.length;
        for (uint256 i = 0; i < assetCount; ++i) {
            _approveAsset(assetsMapped[i]);
        }
        _approveBase();
    }

    // solhint-disable-next-line no-unused-vars
    function _abstractSetPToken(address _asset, address) internal override {
        address poolAsset = toPoolAsset(_asset);
        if (_asset == stETH) {
            // slither-disable-next-line unused-return
            IERC20(stETH).approve(wstETH, 1e50);
        } else if (_asset == frxETH) {
            // slither-disable-next-line unused-return
            IERC20(frxETH).approve(sfrxETH, 1e50);
        }
        _approveAsset(poolAsset);
    }

    /**
     * @dev Approves the Balancer Vault to transfer an asset from
     * this strategy. The assets could be a Vault collateral asset
     * like WETH or rETH; or a Balancer pool asset that wraps the vault asset
     * like wstETH or sfrxETH.
     */
    function _approveAsset(address _asset) internal {
        IERC20 asset = IERC20(_asset);
        // slither-disable-next-line unused-return
        asset.approve(address(balancerVault), type(uint256).max);
    }

    /**
     * @notice Returns the rate supplied by the Balancer configured rate
     * provider. Rate is used to normalize the token to common underlying
     * pool denominator. (ETH for ETH Liquid staking derivatives)
     *
     * @param _asset Address of the Balancer pool asset
     * @return rate of the corresponding asset
     */
    function getRateProviderRate(address _asset)
        internal
        view
        override
        returns (uint256)
    {
        IMetaStablePool pool = IMetaStablePool(platformAddress);
        IRateProvider[] memory providers = pool.getRateProviders();
        (IERC20[] memory tokens, , ) = balancerVault.getPoolTokens(
            balancerPoolId
        );

        uint256 providersLength = providers.length;
        for (uint256 i = 0; i < providersLength; ++i) {
            // _assets and corresponding rate providers are all in the same order
            if (address(tokens[i]) == _asset) {
                // rate provider doesn't exist, defaults to 1e18
                if (address(providers[i]) == address(0)) {
                    return 1e18;
                }
                return providers[i].getRate();
            }
        }

        // should never happen
        assert(false);
    }
}