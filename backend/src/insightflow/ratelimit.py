"""Tek süreçlik kayan pencere istek sınırı. Misafir modunda LLM kredisini korumak için yeterli;
birden çok sunucu örneğine ölçeklenirse Redis gibi paylaşılan bir depoya taşınmalı."""

import time
from collections import defaultdict, deque
from threading import Lock


class SlidingWindowLimiter:
    def __init__(self, max_requests: int, window_seconds: float, clock=time.monotonic):
        self.max_requests = max_requests
        self.window = window_seconds
        self._clock = clock
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str) -> float | None:
        """İzin varsa isteği kaydedip None, yoksa kaç saniye sonra tekrar denenebileceğini döner."""
        now = self._clock()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] >= self.window:
                hits.popleft()
            if len(hits) >= self.max_requests:
                return self.window - (now - hits[0])
            hits.append(now)
            return None
