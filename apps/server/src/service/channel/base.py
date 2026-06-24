from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(slots=True)
class InboundMessage:
    external_user_id: str
    external_chat_id: str
    text: str
    external_event_id: str


class Channel(ABC):
    name: str = ""

    @abstractmethod
    def start(self) -> None: ...
    @abstractmethod
    def stop(self) -> None: ...
    @abstractmethod
    def is_authorized(self, external_user_id: str) -> bool: ...
    @abstractmethod
    def send_ack(self, chat_id: str, text: str) -> None: ...
    @abstractmethod
    def send_report(self, chat_id: str, report: str) -> None: ...
