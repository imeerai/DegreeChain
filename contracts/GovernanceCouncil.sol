// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./interfaces/ICouncil.sol";

/// @title GovernanceCouncil
/// @notice Fixed set of governors (e.g. HEC, a university representative and an
///         independent auditor). Any accreditation decision needs `quorum` of them.
contract GovernanceCouncil is ICouncil {
    error EmptyCouncil();
    error BadQuorum();
    error DuplicateGovernor();
    error ZeroAddress();

    address[] private _governors;
    mapping(address => bool) private _isGovernor;
    uint8 public immutable override quorum;

    event GovernorAdded(address indexed governor);

    constructor(address[] memory governors_, uint8 quorum_) {
        if (governors_.length == 0) revert EmptyCouncil();
        if (quorum_ == 0 || quorum_ > governors_.length) revert BadQuorum();
        for (uint256 i = 0; i < governors_.length; i++) {
            address g = governors_[i];
            if (g == address(0)) revert ZeroAddress();
            if (_isGovernor[g]) revert DuplicateGovernor();
            _isGovernor[g] = true;
            _governors.push(g);
            emit GovernorAdded(g);
        }
        quorum = quorum_;
    }

    function isGovernor(address account) external view override returns (bool) {
        return _isGovernor[account];
    }

    function governors() external view returns (address[] memory) {
        return _governors;
    }
}
