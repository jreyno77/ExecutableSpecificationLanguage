package store.tests.driver;

public class ShoppingDriver {
    private static final java.util.concurrent.CyclicBarrier arrivals = new java.util.concurrent.CyclicBarrier(2);
    private static final java.util.concurrent.atomic.AtomicInteger next = new java.util.concurrent.atomic.AtomicInteger();
    private final int id = next.incrementAndGet();
    private final java.util.Set<String> catalog = new java.util.HashSet<>();
    private final java.util.Map<String, Double> basket = new java.util.HashMap<>();
    public void available(String title) {
        catalog.add(title);
        try { arrivals.await(10, java.util.concurrent.TimeUnit.SECONDS); }
        catch (Exception failure) { throw new AssertionError("Both real scenarios must reach the barrier", failure); }
    }
    public void add(String title) {
        java.util.concurrent.CompletableFuture.runAsync(() -> {
            if (!catalog.contains(title)) throw new IllegalStateException("Unavailable book");
            basket.merge(title, 1.0, Double::sum);
        }).join();
    }
    public double quantity(String title) {
        double actual = basket.getOrDefault(title, 0.0);
        System.out.println("DRIVER:" + id + ":BASKET:" + title + ":" + actual);
        return actual;
    }
}
