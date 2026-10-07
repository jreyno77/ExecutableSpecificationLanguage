"""A real basket used by the generated acceptance tests."""
COPIES_ADDED = 1

class Basket:
    def __init__(self) -> None:
        self.available: set[str] = set()
        self.items: dict[str, int] = {}
    def offer(self, title: str) -> None:
        self.available.add(title)
    def empty(self) -> None:
        self.items.clear()
    def add(self, title: str) -> None:
        if title not in self.available:
            raise ValueError("Book is unavailable")
        self.items[title] = self.quantity(title) + COPIES_ADDED
    def quantity(self, title: str) -> int:
        return self.items.get(title, 0)
