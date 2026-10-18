// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./interfaces/IInstitutionRegistry.sol";

/// @title CredentialRegistry
/// @notice Stores only a fingerprint (SHA-256 hash) of each credential, never the
///         student's personal data. The full record stays off-chain, encrypted.
contract CredentialRegistry {
    error NotAccredited();
    error NotIssuer();
    error EmptyValue();
    error AlreadyExists();
    error NotValid();

    enum Kind { Degree, Transcript, MicroCredential }
    enum CredStatus { None, Valid, Revoked, Superseded }

    struct Credential {
        bytes32 docHash;     // SHA-256 of the canonical credential JSON (includes a random salt)
        address issuer;
        uint64 issuedAt;
        CredStatus status;
        Kind kind;
        bytes32 replacedBy;  // set when an error is corrected
    }

    IInstitutionRegistry public immutable registry;
    mapping(bytes32 => Credential) private _creds;
    uint256 public totalIssued;

    event CredentialIssued(bytes32 indexed id, address indexed issuer, Kind kind, bytes32 docHash);
    event CredentialRevoked(bytes32 indexed id, address indexed issuer, uint8 reasonCode);
    event CredentialCorrected(bytes32 indexed oldId, bytes32 indexed newId, address indexed issuer);

    modifier onlyActiveIssuer() {
        if (!registry.isActive(msg.sender)) revert NotAccredited();
        _;
    }

    constructor(IInstitutionRegistry registry_) {
        if (address(registry_) == address(0)) revert EmptyValue();
        registry = registry_;
    }

    /// @notice An accredited university records a new credential fingerprint.
    function issue(bytes32 id, bytes32 docHash, Kind kind) external onlyActiveIssuer {
        _store(id, docHash, kind);
    }

    /// @notice The issuing university withdraws a credential (fraud, disciplinary case).
    ///         Allowed even if the university is suspended, so bad records can always be withdrawn.
    function revoke(bytes32 id, uint8 reasonCode) external {
        Credential storage c = _creds[id];
        if (c.issuer != msg.sender) revert NotIssuer();
        if (c.status != CredStatus.Valid) revert NotValid();
        c.status = CredStatus.Revoked;
        emit CredentialRevoked(id, msg.sender, reasonCode);
    }

    /// @notice Right to correct: a wrong record is never edited in place. A new one is
    ///         issued and the old one points to it, so the history stays auditable.
    function correct(bytes32 oldId, bytes32 newId, bytes32 newHash) external onlyActiveIssuer {
        Credential storage old = _creds[oldId];
        if (old.issuer != msg.sender) revert NotIssuer();
        if (old.status != CredStatus.Valid) revert NotValid();
        _store(newId, newHash, old.kind);
        old.status = CredStatus.Superseded;
        old.replacedBy = newId;
        emit CredentialCorrected(oldId, newId, msg.sender);
    }

    /// @notice Free, read-only check used by employers and embassies.
    function verify(bytes32 id, bytes32 docHash)
        external
        view
        returns (
            CredStatus status,
            bool hashMatches,
            bool issuerActive,
            address issuer,
            uint64 issuedAt,
            bytes32 replacedBy
        )
    {
        Credential storage c = _creds[id];
        return (
            c.status,
            c.status != CredStatus.None && c.docHash == docHash,
            registry.isActive(c.issuer),
            c.issuer,
            c.issuedAt,
            c.replacedBy
        );
    }

    function _store(bytes32 id, bytes32 docHash, Kind kind) private {
        if (id == bytes32(0) || docHash == bytes32(0)) revert EmptyValue();
        if (_creds[id].status != CredStatus.None) revert AlreadyExists();
        _creds[id] = Credential(docHash, msg.sender, uint64(block.timestamp), CredStatus.Valid, kind, bytes32(0));
        totalIssued += 1;
        emit CredentialIssued(id, msg.sender, kind, docHash);
    }
}
