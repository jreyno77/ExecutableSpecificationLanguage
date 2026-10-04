"""Comparison of finite, ordinary data without application equality hooks."""
import math


def number(value: object) -> float:
    if type(value) not in (int, float):
        raise AssertionError("Expected a finite Number")
    try:
        result = float(value)
    except OverflowError:
        raise AssertionError("Expected an exactly representable finite Number") from None
    if not math.isfinite(result) or type(value) is int and int(result) != value:
        raise AssertionError("Expected an exactly representable finite Number")
    return result


def data(value: object, active: set[int] | None = None) -> tuple:
    if type(value) is bool:
        return ("Boolean", value)
    if type(value) is str:
        return ("Text", value)
    if type(value) in (int, float):
        return ("Number", number(value))
    if value is None:
        return ("Nothing",)
    if type(value) not in (dict, list, tuple):
        raise AssertionError("Expected ordinary comparison data")
    active = set() if active is None else active
    identity = id(value)
    if identity in active:
        raise AssertionError("Cyclic comparison data")
    active.add(identity)
    try:
        if type(value) is dict:
            if any(type(key) is not str for key in value):
                raise AssertionError("Expected Text record keys")
            return ("record", tuple((key, data(value[key], active)) for key in sorted(value)))
        return ("list" if type(value) is list else "tuple", tuple(data(item, active) for item in value))
    finally:
        active.remove(identity)


def equal(actual: object, expected: object) -> bool:
    return data(actual) == data(expected)


def expect_data(actual: object, expected: object) -> None:
    observed, wanted = data(actual), data(expected)
    if observed != wanted:
        if observed[0] == wanted[0] == "Number":
            raise AssertionError(f"Expected {wanted[1]:g}, actual {observed[1]:g}")
        raise AssertionError(f"Expected {wanted!r}, actual {observed!r}")
