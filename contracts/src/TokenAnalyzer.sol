// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function owner() external view returns (address);
}

interface IPair {
    function getReserves() external view returns (uint112, uint112, uint32);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IFactory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

/**
 * @title TokenAnalyzer
 * @notice On-chain token analysis helper
 * @dev Provides token info and basic safety checks
 */
contract TokenAnalyzer {
    struct TokenInfo {
        string name;
        string symbol;
        uint8 decimals;
        uint256 totalSupply;
        address owner;
        bool hasOwner;
        uint256 pairReserve0;
        uint256 pairReserve1;
        address pairAddress;
    }

    struct AnalysisResult {
        bool valid;
        bool hasLiquidity;
        bool hasOwner;
        uint256 liquidityInNative;
        string[] warnings;
    }

    address public immutable factory;
    address public immutable wrappedNative;

    constructor(address _factory, address _wrappedNative) {
        factory = _factory;
        wrappedNative = _wrappedNative;
    }

    function getTokenInfo(address token) external view returns (TokenInfo memory info) {
        // Basic token info
        try IERC20(token).name() returns (string memory name) {
            info.name = name;
        } catch {
            info.name = "Unknown";
        }

        try IERC20(token).symbol() returns (string memory symbol) {
            info.symbol = symbol;
        } catch {
            info.symbol = "???";
        }

        try IERC20(token).decimals() returns (uint8 decimals) {
            info.decimals = decimals;
        } catch {
            info.decimals = 18;
        }

        try IERC20(token).totalSupply() returns (uint256 supply) {
            info.totalSupply = supply;
        } catch {}

        // Check for owner function
        try IERC20(token).owner() returns (address owner) {
            info.owner = owner;
            info.hasOwner = true;
        } catch {
            info.hasOwner = false;
        }

        // Get pair info
        try IFactory(factory).getPair(token, wrappedNative) returns (address pair) {
            if (pair != address(0)) {
                info.pairAddress = pair;
                try IPair(pair).getReserves() returns (uint112 r0, uint112 r1, uint32) {
                    info.pairReserve0 = r0;
                    info.pairReserve1 = r1;
                } catch {}
            }
        } catch {}
    }

    function analyze(address token) external view returns (AnalysisResult memory result) {
        result.valid = true;

        // Check if contract exists
        uint256 size;
        assembly {
            size := extcodesize(token)
        }
        if (size == 0) {
            result.valid = false;
            return result;
        }

        // Get pair
        address pair;
        try IFactory(factory).getPair(token, wrappedNative) returns (address p) {
            pair = p;
        } catch {
            result.valid = false;
            return result;
        }

        if (pair == address(0)) {
            result.hasLiquidity = false;
            return result;
        }

        // Get reserves
        try IPair(pair).getReserves() returns (uint112 r0, uint112 r1, uint32) {
            address token0 = IPair(pair).token0();
            uint256 nativeReserve = token0 == wrappedNative ? r0 : r1;

            result.hasLiquidity = nativeReserve > 0;
            result.liquidityInNative = nativeReserve;
        } catch {
            result.hasLiquidity = false;
        }

        // Check for owner
        try IERC20(token).owner() returns (address) {
            result.hasOwner = true;
        } catch {
            result.hasOwner = false;
        }
    }

    function getLiquidity(address token) external view returns (uint256 nativeReserve) {
        address pair = IFactory(factory).getPair(token, wrappedNative);
        if (pair == address(0)) return 0;

        (uint112 r0, uint112 r1, ) = IPair(pair).getReserves();
        address token0 = IPair(pair).token0();

        return token0 == wrappedNative ? r0 : r1;
    }

    function batchGetLiquidity(address[] calldata tokens) external view returns (uint256[] memory) {
        uint256[] memory results = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            try this.getLiquidity(tokens[i]) returns (uint256 liq) {
                results[i] = liq;
            } catch {
                results[i] = 0;
            }
        }

        return results;
    }
}
