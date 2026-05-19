// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract StrategyVault is ERC4626, Ownable, ReentrancyGuard {
    uint256 public constant MAX_MANAGEMENT_FEE_BPS = 200;
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 2000;
    uint256 public constant BPS = 10000;

    uint256 public managementFeeBps;
    uint256 public performanceFeeBps;
    uint256 public highWaterMark;
    uint256 public lastFeeCollection;

    address public agent;
    bool public paused;

    uint256 public maxTotalDeposit;
    mapping(address => uint256) public maxUserDeposit;

    event AgentUpdated(address indexed oldAgent, address indexed newAgent);
    event FeesCollected(uint256 managementFee, uint256 performanceFee);
    event VaultPaused(bool paused);

    modifier onlyAgent() {
        require(msg.sender == agent, "not agent");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "vault paused");
        _;
    }

    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol,
        address _agent,
        uint256 _managementFeeBps,
        uint256 _performanceFeeBps
    ) ERC4626(_asset) ERC20(_name, _symbol) Ownable(msg.sender) {
        require(_managementFeeBps <= MAX_MANAGEMENT_FEE_BPS, "mgmt fee too high");
        require(_performanceFeeBps <= MAX_PERFORMANCE_FEE_BPS, "perf fee too high");
        agent = _agent;
        managementFeeBps = _managementFeeBps;
        performanceFeeBps = _performanceFeeBps;
        lastFeeCollection = block.timestamp;
        maxTotalDeposit = type(uint256).max;
    }

    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        require(totalAssets() + assets <= maxTotalDeposit, "vault cap");
        return super.deposit(assets, receiver);
    }

    function withdraw(uint256 assets, address receiver, address _owner)
        public
        override
        nonReentrant
        returns (uint256)
    {
        return super.withdraw(assets, receiver, _owner);
    }

    function executeStrategy(
        address target,
        bytes calldata data
    ) external onlyAgent whenNotPaused returns (bytes memory) {
        (bool success, bytes memory result) = target.call(data);
        require(success, "strategy call failed");
        return result;
    }

    function collectFees() external onlyOwner {
        uint256 totalVal = totalAssets();
        uint256 elapsed = block.timestamp - lastFeeCollection;

        uint256 mgmtFee = (totalVal * managementFeeBps * elapsed) / (BPS * 365 days);

        uint256 perfFee = 0;
        if (totalVal > highWaterMark) {
            uint256 profit = totalVal - highWaterMark;
            perfFee = (profit * performanceFeeBps) / BPS;
            highWaterMark = totalVal;
        }

        lastFeeCollection = block.timestamp;

        if (mgmtFee + perfFee > 0) {
            uint256 shares = convertToShares(mgmtFee + perfFee);
            if (shares > 0) {
                _mint(owner(), shares);
            }
        }

        emit FeesCollected(mgmtFee, perfFee);
    }

    function setAgent(address _agent) external onlyOwner {
        emit AgentUpdated(agent, _agent);
        agent = _agent;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit VaultPaused(_paused);
    }

    function setMaxTotalDeposit(uint256 _max) external onlyOwner {
        maxTotalDeposit = _max;
    }
}
