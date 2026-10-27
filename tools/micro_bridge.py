"""Bounded Micro reads through Origo, tied to the held cube's trade generations."""
from __future__ import annotations

import hashlib
import json
import threading
from datetime import UTC, datetime

from market_state_reader import MarketStateError, micro


def stamp(value: str) -> int:
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return int((parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)).timestamp() * 1000)


def relevant_digest(pins: dict, start: int, end: int) -> str:
    selected = []
    for key, identity in pins.items():
        at = stamp(key)
        until = at + (60000 if 'T' in key else 86400000)
        if at < end and until > start:
            if not isinstance(identity, list) or len(identity) != 2 or not all(isinstance(v, str) for v in identity):
                raise ValueError('Invalid held trade generation.')
            selected.append([key, *identity])
    return hashlib.sha256(json.dumps(sorted(selected), separators=(',', ':')).encode()).hexdigest()


class MicroStore:
    def __init__(self, explorer, url: str, slot) -> None:
        self.explorer, self.url, self.slot = explorer, url, slot
        self.answers: dict[tuple, dict] = {}
        self.lock = threading.Lock()

    def query(self, body: dict) -> dict:
        if not isinstance(body, dict) or set(body) != {'pack', 'from', 'to', 'step', 'as_of'}:
            raise ValueError('Unexpected or missing Micro fields.')
        if not isinstance(body['pack'], str) or any(isinstance(body[k], bool) or not isinstance(body[k], int)
                                                   for k in ('from', 'to', 'step', 'as_of')):
            raise ValueError('Micro requires a held pack and integer UTC millisecond times.')
        held = self.explorer.holding(body['pack'])
        if not 0 <= body['from'] < body['to'] <= body['as_of'] <= stamp(held['state']['data_cutoff']):
            raise ValueError('Micro must end no later than the held cube or replay edge.')
        request = {key: body[key] for key in ('from', 'to', 'step', 'as_of')}
        request['trade_pin_digest'] = relevant_digest(held['pins'], body['from'], body['to'])
        key = tuple(body[k] for k in ('pack', 'from', 'to', 'step', 'as_of'))
        with self.lock:
            if key in self.answers:
                return self.answers[key]
        if not self.slot.acquire(timeout=20):
            raise MarketStateError(503, {'error': 'busy'})
        try:
            with self.lock:
                if key in self.answers:
                    return self.answers[key]
            answer = dict(micro(request, url=self.url))
            if any(answer.get(name) != request[field] for name, field in
                   (('from', 'from'), ('to', 'to'), ('step', 'step'), ('asOf', 'as_of'))):
                raise ValueError('Micro response bounds differ from the requested cube context.')
            with self.lock:
                self.answers[key] = answer
                while len(self.answers) > 8:
                    del self.answers[next(iter(self.answers))]
            return answer
        finally:
            self.slot.release()
