// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./interfaces/ICouncil.sol";
import "./interfaces/IInstitutionRegistry.sol";

/// @title InstitutionRegistry
/// @notice Keeps the list of universities that are allowed to issue credentials.
///         Accreditation and suspension both need a quorum of council votes.
contract InstitutionRegistry is IInstitutionRegistry {
    error NotGovernor();
    error ZeroAddress();
    error AlreadyActive();
    error NotActive();
    error AlreadyVoted();
    error EmptyName();

    enum Status { None, Pending, Active, Suspended }

    struct Institution {
        string name;
        Status status;
        uint8 votes;     // votes collected in the current round
        uint32 round;    // increases after every status change, so old votes expire
    }

    ICouncil public immutable council;
    mapping(address => Institution) public institutions;
    // institution => round => governor => voted?
    mapping(address => mapping(uint32 => mapping(address => bool))) private _voted;

    event ApprovalVoted(address indexed institution, address indexed governor, uint8 votes);
    event InstitutionAccredited(address indexed institution, string name);
    event SuspensionVoted(address indexed institution, address indexed governor, uint8 votes);
    event InstitutionSuspended(address indexed institution, uint8 reasonCode);

    modifier onlyGovernor() {
        if (!council.isGovernor(msg.sender)) revert NotGovernor();
        _;
    }

    constructor(ICouncil council_) {
        if (address(council_) == address(0)) revert ZeroAddress();
        council = council_;
    }

    /// @notice A governor votes to accredit (or re-accredit) an institution.
    function approveInstitution(address inst, string calldata name) external onlyGovernor {
        if (inst == address(0)) revert ZeroAddress();
        Institution storage i = institutions[inst];
        if (i.status == Status.Active) revert AlreadyActive();
        if (i.status == Status.None) {
            if (bytes(name).length == 0) revert EmptyName();
            i.name = name;
            i.status = Status.Pending;
        }
        uint8 votes = _castVote(inst, i);
        emit ApprovalVoted(inst, msg.sender, votes);

        if (votes >= council.quorum()) {
            i.status = Status.Active;
            _nextRound(i);
            emit InstitutionAccredited(inst, i.name);
        }
    }

    /// @notice A governor votes to suspend an institution (e.g. degree-mill evidence).
    ///         Credentials it already issued stay on record; verifiers see the warning.
    function suspendInstitution(address inst, uint8 reasonCode) external onlyGovernor {
        Institution storage i = institutions[inst];
        if (i.status != Status.Active) revert NotActive();
        uint8 votes = _castVote(inst, i);
        emit SuspensionVoted(inst, msg.sender, votes);

        if (votes >= council.quorum()) {
            i.status = Status.Suspended;
            _nextRound(i);
            emit InstitutionSuspended(inst, reasonCode);
        }
    }

    function isActive(address inst) external view override returns (bool) {
        return institutions[inst].status == Status.Active;
    }

    function _castVote(address inst, Institution storage i) private returns (uint8) {
        if (_voted[inst][i.round][msg.sender]) revert AlreadyVoted();
        _voted[inst][i.round][msg.sender] = true;
        i.votes += 1;
        return i.votes;
    }

    function _nextRound(Institution storage i) private {
        i.votes = 0;
        i.round += 1;
    }
}
