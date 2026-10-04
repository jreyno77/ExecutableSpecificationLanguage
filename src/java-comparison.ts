import { javaListClass } from './java-types.js';

/** Emitted JUnit data comparison: only known native data projections enter the oracle. */
export function javaComparison(records: readonly { type: string; fields: readonly { name: string; accessor: string }[] }[]): string {
  const cases = records.map(record => `        if (value.getClass() == ${record.type}.class) {
            var item = (${record.type})value;
            return new Value("record", ${JSON.stringify(record.type)}, java.util.List.of(${record.fields.map(field => JSON.stringify(field.name)).join(', ')}),
                java.util.List.of(${record.fields.map(field => 'data(item.' + field.accessor + '(), path + ' + JSON.stringify('.' + field.name) + ', active)').join(', ')}));
        }`).join('\n');
  return `public final class ExpecChecks {
    private ExpecChecks() {}
    private record Value(String kind, Object scalar, java.util.List<String> names, java.util.List<Value> items) {}
    public static double number(double value) { if (!Double.isFinite(value)) throw new IllegalArgumentException("finite Number required"); return value == 0 ? 0.0 : value; }
    private static Value leaf(String kind, Object value) { return new Value(kind,value,java.util.List.of(),java.util.List.of()); }
    private static Value data(Object value, String path, java.util.IdentityHashMap<Object,Boolean> active) {
        if (value == null) throw new IllegalArgumentException(path + ": required comparison data");
        if (value.getClass() == Double.class) return leaf("Number",number((Double)value));
        if (value.getClass() == String.class) return leaf("Text",value);
        if (value.getClass() == Boolean.class) return leaf("Boolean",value);
        if (active.put(value,Boolean.TRUE) != null) throw new IllegalArgumentException(path + ": cyclic comparison data");
        try {
            if (value instanceof java.util.Optional<?> item) return new Value("optional",item.isPresent(),java.util.List.of(),
                item.isPresent() ? java.util.List.of(data(item.get(),path + ".value",active)) : java.util.List.of());
            Class<?> kind = value.getClass();
            if (${javaListClass("kind")}) {
                var list = (java.util.List<?>)value;
                var items = new java.util.ArrayList<Value>();
                for (int index=0; index<list.size(); index++) items.add(data(list.get(index),path + "[" + index + "]",active));
                return new Value("list",list.size(),java.util.List.of(),items);
            }
${cases}
            throw new IllegalArgumentException(path + ": unsupported comparison data: " + value.getClass().getName());
        } finally { active.remove(value); }
    }
    private static Value data(Object value) { return data(value,"value",new java.util.IdentityHashMap<>()); }
    public static boolean same(Object actual, Object expected) { return data(actual).equals(data(expected)); }
    private static void equal(Value actual, Value expected, String path) {
        org.junit.jupiter.api.Assertions.assertEquals(expected.kind(),actual.kind(),path);
        org.junit.jupiter.api.Assertions.assertEquals(expected.scalar(),actual.scalar(),path);
        org.junit.jupiter.api.Assertions.assertEquals(expected.names(),actual.names(),path);
        for (int index=0; index<expected.items().size(); index++) {
            String child = expected.kind().equals("record") ? "." + expected.names().get(index)
                : expected.kind().equals("optional") ? ".value" : "[" + index + "]";
            equal(actual.items().get(index),expected.items().get(index),path + child);
        }
    }
    public static void equal(Object actual, Object expected) { equal(data(actual),data(expected),"value"); }
}`;
}
