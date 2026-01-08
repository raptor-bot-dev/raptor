// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/RaptorVault.sol";
import "../src/ExecutionEngine.sol";
import "../src/TokenAnalyzer.sol";

contract DeployScript is Script {
    // BSC Mainnet
    address constant BSC_PANCAKE_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address constant BSC_PANCAKE_FACTORY = 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;
    address constant BSC_WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;

    // Base Mainnet
    address constant BASE_UNISWAP_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address constant BASE_UNISWAP_FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory network = vm.envString("NETWORK");

        vm.startBroadcast(deployerPrivateKey);

        address router;
        address factory;
        address wrappedNative;

        if (keccak256(bytes(network)) == keccak256("bsc")) {
            router = BSC_PANCAKE_ROUTER;
            factory = BSC_PANCAKE_FACTORY;
            wrappedNative = BSC_WBNB;
        } else if (keccak256(bytes(network)) == keccak256("base")) {
            router = BASE_UNISWAP_ROUTER;
            factory = BASE_UNISWAP_FACTORY;
            wrappedNative = BASE_WETH;
        } else {
            revert("Unknown network");
        }

        // Deploy Vault
        RaptorVault vault = new RaptorVault(router);
        console.log("RaptorVault deployed at:", address(vault));

        // Deploy Execution Engine
        ExecutionEngine engine = new ExecutionEngine(address(vault));
        console.log("ExecutionEngine deployed at:", address(engine));

        // Set execution engine as vault executor
        vault.setExecutor(address(engine));
        console.log("Executor set on vault");

        // Deploy Token Analyzer
        TokenAnalyzer analyzer = new TokenAnalyzer(factory, wrappedNative);
        console.log("TokenAnalyzer deployed at:", address(analyzer));

        vm.stopBroadcast();
    }
}
