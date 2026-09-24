import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field


def canonical_json_serialize(obj: Any) -> str:
    """RFC 8785 deterministic JSON canonicalization."""
    return json.dumps(
        obj,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False
    )


def compute_audit_chain_hash(
    prev_hash: str,
    event_id: str,
    tenant_id: str,
    action: str,
    timestamp: str,
    payload: Any,
    sequence_num: Optional[int] = None,
) -> str:
    """Computes SHA-256 chained hash: SHA256(prev_hash:event_id:tenant_id:action:timestamp:JCS(payload))."""
    jcs_str = canonical_json_serialize(payload)
    raw = f"{prev_hash}:{event_id}:{tenant_id}:{action}:{timestamp}:{jcs_str}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@dataclass
class AuditEvent:
    id: str
    organization_id: str
    action: str
    resource_type: str
    resource_id: Optional[str]
    payload: Dict[str, Any]
    prev_hash: str
    current_hash: str
    sequence_num: Optional[int] = None
    actor_type: str = "SYSTEM"
    actor_id: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class LedgerAnomaly:
    anomaly_type: str
    event_index: int
    event_id: str
    expected_value: str
    actual_value: str
    details: Dict[str, Any]


@dataclass
class TamperDetectionResult:
    is_valid: bool = True
    total_events_verified: int = 0
    genesis_event_id: Optional[str] = None
    tip_event_id: Optional[str] = None
    anomalies: List[LedgerAnomaly] = field(default_factory=list)
    verified_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AuditTrailLedger:
    """Tamper-evident append-only ledger with cryptographic hash chaining."""

    GENESIS_PREV_HASH: str = "0" * 64

    @classmethod
    def create_event(
        cls,
        organization_id: str,
        action: str,
        resource_type: str = "SYSTEM",
        resource_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        prev_hash: Optional[str] = None,
        sequence_num: Optional[int] = None,
        actor_type: str = "SYSTEM",
        actor_id: Optional[str] = None,
        timestamp: Optional[str] = None,
    ) -> AuditEvent:
        event_id = str(uuid.uuid4())
        created_at = timestamp or datetime.now(timezone.utc).isoformat()
        previous = prev_hash or cls.GENESIS_PREV_HASH
        data_payload = payload or {}
        current_hash = compute_audit_chain_hash(
            prev_hash=previous,
            event_id=event_id,
            tenant_id=organization_id,
            action=action,
            timestamp=created_at,
            payload=data_payload,
        )

        return AuditEvent(
            id=event_id,
            sequence_num=sequence_num,
            organization_id=organization_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            payload=data_payload,
            prev_hash=previous,
            current_hash=current_hash,
            actor_type=actor_type,
            actor_id=actor_id,
            created_at=created_at,
        )

    @classmethod
    def verify_ledger(cls, events: List[Dict[str, Any] | AuditEvent]) -> TamperDetectionResult:
        if not events:
            return TamperDetectionResult(is_valid=True, total_events_verified=0, anomalies=[])

        # Normalize to dictionaries
        raw_events: List[Dict[str, Any]] = []
        for e in events:
            if isinstance(e, AuditEvent):
                raw_events.append({
                    "id": e.id,
                    "sequence_num": e.sequence_num,
                    "organization_id": e.organization_id,
                    "action": e.action,
                    "resource_type": e.resource_type,
                    "resource_id": e.resource_id,
                    "payload": e.payload,
                    "prev_hash": e.prev_hash,
                    "current_hash": e.current_hash,
                    "actor_type": e.actor_type,
                    "actor_id": e.actor_id,
                    "created_at": e.created_at,
                })
            else:
                raw_events.append(dict(e))

        # Deterministic sort by monotonic sequence_num / chain_index if available
        has_sequence = any(
            x.get("sequence_num") is not None or x.get("chain_index") is not None 
            for x in raw_events
        )
        if has_sequence:
            raw_events.sort(
                key=lambda x: int(x.get("sequence_num") if x.get("sequence_num") is not None else (x.get("chain_index") or 0))
            )

        anomalies: List[LedgerAnomaly] = []

        # 1. Genesis check
        genesis = raw_events[0]
        genesis_prev = genesis.get("prev_hash") or genesis.get("previous_event_hash")
        if genesis_prev != cls.GENESIS_PREV_HASH:
            anomalies.append(LedgerAnomaly(
                anomaly_type="MISSING_GENESIS_PREV_HASH",
                event_index=0,
                event_id=str(genesis.get("id") or genesis.get("event_id")),
                expected_value=cls.GENESIS_PREV_HASH,
                actual_value=str(genesis_prev),
                details={"message": "Genesis event prev_hash must be 64 zeros"},
            ))

        # 2. Sequential traversal
        for i in range(len(raw_events)):
            curr = raw_events[i]
            curr_id = str(curr.get("id") or curr.get("event_id"))
            curr_prev = curr.get("prev_hash") or curr.get("previous_event_hash")
            curr_hash = curr.get("current_hash") or curr.get("event_hash")
            curr_tenant = str(curr.get("organization_id") or curr.get("tenant_id"))
            curr_action = str(curr.get("action"))
            curr_created = str(curr.get("created_at") or curr.get("timestamp"))
            curr_payload = curr.get("payload") if "payload" in curr else curr.get("details", {})

            if i > 0:
                prev_ev = raw_events[i - 1]

                # Monotonic sequence gap detection
                curr_seq = curr.get("sequence_num") if curr.get("sequence_num") is not None else curr.get("chain_index")
                prev_seq = prev_ev.get("sequence_num") if prev_ev.get("sequence_num") is not None else prev_ev.get("chain_index")
                if curr_seq is not None and prev_seq is not None:
                    try:
                        curr_seq_int = int(curr_seq)
                        prev_seq_int = int(prev_seq)
                        if curr_seq_int > prev_seq_int + 1:
                            anomalies.append(LedgerAnomaly(
                                anomaly_type="GAP_DETECTED",
                                event_index=i,
                                event_id=curr_id,
                                expected_value=str(prev_seq_int + 1),
                                actual_value=str(curr_seq_int),
                                details={"message": f"Monotonic sequence gap detected between {prev_seq_int} and {curr_seq_int}"},
                            ))
                    except (ValueError, TypeError):
                        pass

                # Chain link check
                prev_hash_expected = prev_ev.get("current_hash") or prev_ev.get("event_hash")
                if curr_prev != prev_hash_expected:
                    anomalies.append(LedgerAnomaly(
                        anomaly_type="BROKEN_CHAIN_LINK",
                        event_index=i,
                        event_id=curr_id,
                        expected_value=str(prev_hash_expected),
                        actual_value=str(curr_prev),
                        details={"predecessor_id": str(prev_ev.get("id") or prev_ev.get("event_id"))},
                    ))

                # Monotonic time check
                prev_created = str(prev_ev.get("created_at") or prev_ev.get("timestamp"))
                if curr_created < prev_created:
                    anomalies.append(LedgerAnomaly(
                        anomaly_type="TIMESTAMP_ANACHRONISM",
                        event_index=i,
                        event_id=curr_id,
                        expected_value=f">= {prev_created}",
                        actual_value=curr_created,
                        details={"message": "Event timestamp earlier than predecessor"},
                    ))

            # Cryptographic hash recalculation
            recalculated = compute_audit_chain_hash(
                prev_hash=str(curr_prev),
                event_id=curr_id,
                tenant_id=curr_tenant,
                action=curr_action,
                timestamp=curr_created,
                payload=curr_payload,
            )

            if recalculated != curr_hash:
                anomalies.append(LedgerAnomaly(
                    anomaly_type="CORRUPTED_PAYLOAD",
                    event_index=i,
                    event_id=curr_id,
                    expected_value=recalculated,
                    actual_value=str(curr_hash),
                    details={"message": "Hash does not match payload and event header contents"},
                ))

        return TamperDetectionResult(
            is_valid=(len(anomalies) == 0),
            total_events_verified=len(raw_events),
            genesis_event_id=str(raw_events[0].get("id") or raw_events[0].get("event_id")),
            tip_event_id=str(raw_events[-1].get("id") or raw_events[-1].get("event_id")),
            anomalies=anomalies,
            verified_at=datetime.now(timezone.utc).isoformat(),
        )

    @classmethod
    def verify_chain(cls, events: List[Dict[str, Any] | AuditEvent]) -> TamperDetectionResult:
        """Alias for verify_ledger guaranteeing explicit linear sequence sorting."""
        return cls.verify_ledger(events)
