"""Comparison of finite, ordinary data without application equality hooks."""
import math
from typing import Any, TypeVar, cast

T = TypeVar("T")


def number(value: object) -> float:
    if type(value) not in (int, float):
        raise AssertionError("Expected a finite Number")
    try:
        result = float(cast(int | float, value))
    except OverflowError:
        raise AssertionError("Expected an exactly representable finite Number") from None
    if not math.isfinite(result) or type(value) is int and int(result) != value:
        raise AssertionError("Expected an exactly representable finite Number")
    return result


def data(value: object, active: set[int] | None = None) -> tuple[object, ...]:
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
        return ("list" if type(value) is list else "tuple", tuple(data(item, active) for item in cast(list[object] | tuple[object, ...], value)))
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


def checked(value: T, shapes: list[list[Any]], index: int, active: set[int] | None = None) -> T:
    shape = shapes[int(index)]
    kind = shape[0]
    if kind == "Number":
        return cast(T, number(value))
    if kind in ("Text", "Boolean", "Nothing"):
        expected = {"Text": str, "Boolean": bool, "Nothing": type(None)}[kind]
        if type(value) is not expected:
            raise AssertionError("Expected " + kind)
        return value
    if kind in ("alias", "optional"):
        return checked(value, shapes, shape[1], active)
    if kind == "literal":
        if not equal(value, shape[1]):
            raise AssertionError("Expected the declared literal value")
        return value
    if kind == "union":
        for option in shape[1:]:
            try:
                return checked(value, shapes, option, active)
            except AssertionError:
                pass
        raise AssertionError("Expected a declared union alternative")
    if kind not in ("record", "List", "tuple"):
        raise AssertionError("This value needs an explicit comparison contract")
    container = {"record": dict, "List": list, "tuple": tuple}[kind]
    observed: object = value
    if type(observed) is not container:
        raise AssertionError("Expected ordinary " + kind + " data")
    active = set() if active is None else active
    identity = id(value)
    if identity in active:
        raise AssertionError("Cyclic comparison data")
    active.add(identity)
    try:
        if kind == "record":
            record = cast(dict[str, object], value)
            if any(type(key) is not str for key in record):
                raise AssertionError("Expected Text record keys")
            fields = dict(shape[1:])
            if any(key not in fields for key in record):
                raise AssertionError("Unknown record field")
            for key, field in fields.items():
                if key in record:
                    checked(record[key], shapes, field, active)
                elif shapes[int(field)][0] != "optional":
                    raise AssertionError("Missing required field: " + key)
        elif kind == "List":
            for item in cast(list[object], value):
                checked(item, shapes, shape[1], active)
        else:
            sequence = cast(tuple[object, ...], value)
            if len(sequence) != len(shape) - 1:
                raise AssertionError("Expected the declared tuple length")
            for item, field in zip(sequence, shape[1:]):
                checked(item, shapes, field, active)
        return value
    finally:
        active.remove(identity)
