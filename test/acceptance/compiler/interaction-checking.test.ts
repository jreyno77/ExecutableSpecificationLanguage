import { describe, it } from 'vitest';
import { InteractionExamples } from '../../dsl/compiler/interaction-checking.js';

describe('checking declared communications', () => {
  it("checks saving a snapshot and passing its receipt to the screen", () => {
    const communications = new InteractionExamples();
    communications.source(`type Snapshot { title: Text }
  type Receipt { id: Text }
  interface Storage {
    public persist
    capability persist(snapshot: Snapshot) returns Receipt
  }
  component Screen {
    public showSaved
    capability showSaved(receipt: Receipt) returns Nothing
  }
  interaction "save and confirm"(snapshot: Snapshot) {
    participant screen: Screen
    participant storage: Storage
    message screen -> storage.persist(snapshot) as receipt
    message storage -> screen.showSaved(receipt)
  }`);

    communications.checkInteraction("save and confirm");

    communications.expectStaticallyValid();
    communications.expectMessages("save and confirm", [
      { from: "screen", to: "storage", operation: "Storage.persist" },
      { from: "storage", to: "screen", operation: "Screen.showSaved" },
    ]);
    communications.expectCapturedReply("save and confirm", "receipt", "Receipt");
    communications.expectArguments("save and confirm", 2, ["receipt"]);
  });

  it("rejects a receiver introduced after its message", () => {
    const communications = new InteractionExamples();
    communications.source(`component Screen {}
  interface Storage {
    public persist
    capability persist() returns Nothing
  }
  interaction "storage introduced later"() {
    participant screen: Screen
    message screen -> storage.persist()
    participant storage: Storage
  }`);

    communications.checkInteraction("storage introduced later");

    communications.expectProblem("invalid-participant", {
      text: "storage", within: "message screen -> storage.persist()",
    });
  });

  it("does not use a type declaration as a sender participant", () => {
    const communications = new InteractionExamples();
    communications.source(`component Screen {}
  interface Storage {
    public persist
    capability persist() returns Nothing
  }
  interaction "missing screen participant"() {
    participant storage: Storage
    message Screen -> storage.persist()
  }`);

    communications.checkInteraction("missing screen participant");

    communications.expectProblem("invalid-participant", {
      text: "Screen", within: "message Screen -> storage.persist()",
    });
  });

  it("rejects a numeric participant even when there are no messages", () => {
    const communications = new InteractionExamples();
    communications.source(`interaction "numeric participant"() {
    participant storage: Number
  }`);

    communications.checkInteraction("numeric participant");

    communications.expectProblem("invalid-participant", { text: "Number" });
  });

  it("keeps a duplicate participant ambiguous even before the second introduction", () => {
    const communications = new InteractionExamples();
    communications.source(`component Screen {
    public refresh
    capability refresh() returns Nothing
  }
  component OtherScreen {}
  interaction "duplicate screen"() {
    participant screen: Screen
    message screen -> screen.refresh()
    participant screen: OtherScreen
  }`);

    communications.checkInteraction("duplicate screen");

    communications.expectProblem("duplicate-declaration", {
      text: "participant screen: OtherScreen",
    });
    communications.expectRelated({ text: "participant screen: Screen" });

    communications.checkMessage("duplicate screen", 1);
    communications.expectNoCommunication("duplicate screen", 1);
  });

  it("accepts an alias identifying a participant contract", () => {
    const communications = new InteractionExamples();
    communications.source(`type Endpoint<T> = T
  interface Storage {
    public persist
    capability persist() returns Nothing
  }
  interaction "aliased storage"() {
    participant storage: Endpoint<Storage>
    message storage -> storage.persist()
  }`);

    communications.checkInteraction("aliased storage");

    communications.expectStaticallyValid();
    communications.expectMessages("aliased storage", [
      { from: "storage", to: "storage", operation: "Storage.persist" },
    ]);
  });

  it("does not turn a qualified endpoint into a local participant", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist() returns Nothing
  }
  interaction "qualified endpoint"() {
    participant storage: Storage
    message storage -> services.storage.persist()
  }`);

    communications.checkInteraction("qualified endpoint");

    communications.expectProblem("invalid-participant", { text: "services.storage" });
  });

  it("keeps a quoted dot inside one participant name", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist() returns Nothing
  }
  interaction "quoted endpoint"() {
    participant \`services.storage\`: Storage
    message \`services.storage\` -> \`services.storage\`.persist()
  }`);

    communications.checkInteraction("quoted endpoint");

    communications.expectStaticallyValid();
    communications.expectMessages("quoted endpoint", [
      { from: "services.storage", to: "services.storage", operation: "Storage.persist" },
    ]);
  });

  it("requires a public capability even inside its own component", () => {
    const communications = new InteractionExamples();
    communications.source(`component Storage {
    capability persist() returns Nothing
    interaction "private persistence"() {
      participant storage: Storage
      message storage -> storage.persist()
    }
  }`);

    communications.checkInteraction("private persistence");

    communications.expectProblem("invalid-member", {
      text: "persist", within: "message storage -> storage.persist()",
    });
  });

  it("does not borrow the sender's capability for the receiver", () => {
    const communications = new InteractionExamples();
    communications.source(`component Screen {
    public persist
    capability persist() returns Nothing
  }
  interface Storage {}
  interaction "wrong owner"() {
    participant screen: Screen
    participant storage: Storage
    message screen -> storage.persist()
  }`);

    communications.checkInteraction("wrong owner");

    communications.expectProblem("invalid-member", {
      text: "persist", within: "message screen -> storage.persist()",
    });
  });

  it("reports a misspelled public operation at the authored selector", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist() returns Nothing
  }
  interaction "misspelled operation"() {
    participant storage: Storage
    message storage -> storage.persisst()
  }`);

    communications.checkInteraction("misspelled operation");

    communications.expectProblem("invalid-member", { text: "persisst" });
  });

  it("checks a message argument against the capability's declared type", () => {
    const communications = new InteractionExamples();
    communications.source(`type Snapshot { title: Text }
  interface Storage {
    public persist
    capability persist(snapshot: Snapshot) returns Nothing
  }
  interaction "wrong snapshot"() {
    participant storage: Storage
    message storage -> storage.persist(8)
  }`);

    communications.checkInteraction("wrong snapshot");

    communications.expectProblem("incompatible-type", { text: "8" });
  });

  it("reports an extra message argument using the ordinary arity rule", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist(snapshot: Text) returns Nothing
  }
  interaction "too many arguments"() {
    participant storage: Storage
    message storage -> storage.persist("Dune", "extra")
  }`);

    communications.checkInteraction("too many arguments");

    communications.expectProblem("invalid-arity", {
      text: 'message storage -> storage.persist("Dune", "extra")',
    });
  });

  it("uses expected record and list types and leaves omitted defaults unwritten", () => {
    const communications = new InteractionExamples();
    communications.source(`type Snapshot { title: Text }
  interface Storage {
    public persist
    capability persist(snapshots: List<Snapshot>, attempts: Number = 1) returns Nothing
  }
  interaction "contextual data"() {
    participant storage: Storage
    message storage -> storage.persist([{ title: "Dune" }])
    message storage -> storage.persist([])
  }`);

    communications.checkInteraction("contextual data");

    communications.expectStaticallyValid();
    communications.expectArguments("contextual data", 1, ['[{ title: "Dune" }]']);
    communications.expectArguments("contextual data", 2, ["[]"]);
  });

  it("requires a participant to be introduced before it is used as an argument", () => {
    const communications = new InteractionExamples();
    communications.source(`component Screen {}
  interface Storage {
    public connect
    capability connect(screen: Screen) returns Nothing
  }
  interaction "late argument participant"() {
    participant storage: Storage
    message storage -> storage.connect(screen)
    participant screen: Screen
  }`);

    communications.checkInteraction("late argument participant");

    communications.expectProblem("unavailable-value", {
      text: "screen", within: "message storage -> storage.connect(screen)",
    });
  });

  it("does not use a receipt before the message that captures it", () => {
    const communications = new InteractionExamples();
    communications.source(`type Receipt { id: Text }
  interface Storage {
    public persist, showSaved
    capability persist() returns Receipt
    capability showSaved(receipt: Receipt) returns Nothing
  }
  interaction "confirmation before saving"() {
    participant storage: Storage
    message storage -> storage.showSaved(receipt)
    message storage -> storage.persist() as receipt
  }`);

    communications.checkInteraction("confirmation before saving");

    communications.expectProblem("unavailable-value", {
      text: "receipt", within: "message storage -> storage.showSaved(receipt)",
    });
  });

  it("does not replace an interaction input with a captured reply", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist() returns Text
  }
  interaction "receipt name already used"(receipt: Text) {
    participant storage: Storage
    message storage -> storage.persist() as receipt
  }`);

    communications.checkInteraction("receipt name already used");

    communications.expectProblem("duplicate-capture", {
      text: "receipt", within: "message storage -> storage.persist() as receipt",
    });
    communications.expectRelated({ text: "receipt: Text" });
  });

  it("rejects a second capture with the same name", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist(value: Number) returns Text
  }
  interaction "duplicate receipt"() {
    participant storage: Storage
    message storage -> storage.persist(1) as receipt
    message storage -> storage.persist(2) as receipt
  }`);

    communications.checkInteraction("duplicate receipt");

    communications.expectProblem("duplicate-capture", {
      text: "receipt", within: "message storage -> storage.persist(2) as receipt",
    });
    communications.expectRelated({
      text: "receipt", within: "message storage -> storage.persist(1) as receipt",
    });

    communications.checkMessage("duplicate receipt", 1);
    communications.expectNoCommunication("duplicate receipt", 1);
  });

  it("does not share captured replies between interactions", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist, confirm
    capability persist() returns Text
    capability confirm(receipt: Text) returns Nothing
  }
  interaction "save"() {
    participant storage: Storage
    message storage -> storage.persist() as receipt
  }
  interaction "separate confirmation"() {
    participant storage: Storage
    message storage -> storage.confirm(receipt)
  }`);

    communications.checkInteraction("save");
    communications.expectStaticallyValid();

    communications.checkInteraction("separate confirmation");

    communications.expectProblem("unresolved-reference", {
      text: "receipt", within: "message storage -> storage.confirm(receipt)",
    });
  });

  it("rejects capturing a reply from an operation returning Nothing", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist() returns Nothing
  }
  interaction "capture no reply"() {
    participant storage: Storage
    message storage -> storage.persist() as receipt
  }`);

    communications.checkInteraction("capture no reply");

    communications.expectProblem("invalid-purpose", {
      text: "receipt", within: "message storage -> storage.persist() as receipt",
    });
  });

  it("keeps a captured reply incomplete when its result is unspecified", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist()
  }
  interaction "unknown reply"() {
    participant storage: Storage
    message storage -> storage.persist() as receipt
  }`);

    communications.checkInteraction("unknown reply");

    communications.expectDeferred("declared-result", {
      text: "receipt", within: "message storage -> storage.persist() as receipt",
    });
    communications.expectNoProblems();
    communications.expectNoCommunication("unknown reply", 1);
  });

  it("allows an unspecified output when the message captures no value", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist()
  }
  interaction "send only"() {
    participant storage: Storage
    message storage -> storage.persist()
  }`);

    communications.checkInteraction("send only");

    communications.expectStaticallyValid();
    communications.expectNoCapturedReplies("send only");
  });

  it("keeps an invalid producing message's cause when its reply is used", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist, confirm
    capability persist(count: Number) returns Text
    capability confirm(receipt: Text) returns Nothing
  }
  interaction "invalid producer"() {
    participant storage: Storage
    message storage -> storage.persist("many") as receipt
    message storage -> storage.confirm(receipt)
  }`);

    communications.checkMessage("invalid producer", 2);

    communications.expectProblem("incompatible-type", { text: '"many"' });
    communications.expectRelated({
      text: "receipt", within: "message storage -> storage.confirm(receipt)",
    });
    communications.expectNoCommunication("invalid producer", 2);
  });

  it("treats result as an ordinary reply name", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist, confirm
    capability persist() returns Text
    capability confirm(receipt: Text) returns Nothing
  }
  interaction "ordinary result name"() {
    participant storage: Storage
    message storage -> storage.persist() as result
    message storage -> storage.confirm(result)
  }`);

    communications.checkInteraction("ordinary result name");

    communications.expectStaticallyValid();
    communications.expectCapturedReply("ordinary result name", "result", "Text");
  });

  it("uses a bodyless external capability through the same message contract", () => {
    const communications = new InteractionExamples();
    communications.externalModule("storage", [{
      kind: "interface", name: "Storage", public: ["persist"],
      members: [{
        kind: "capability", name: "persist",
        parameters: [{ name: "snapshot", type: { kind: "builtin", name: "Text" } }],
        result: { kind: "builtin", name: "Text" },
      }],
    }]);
    communications.source(`use Storage from "storage"
  interaction "external persistence"(snapshot: Text) {
    participant storage: Storage
    message storage -> storage.persist(snapshot) as receipt
  }`);

    communications.checkInteraction("external persistence");

    communications.expectStaticallyValid();
    communications.expectMessages("external persistence", [
      { from: "storage", to: "storage", operation: "Storage.persist" },
    ]);
    communications.expectOperationOrigin("external persistence", 1, {
      module: "storage", path: [0, "members", 0],
    });
    communications.expectCapturedReply("external persistence", "receipt", "Text");
  });

  it("does not invent messages from a dependency or a captured reply", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist() returns Text
  }
  component Screen { depends on Storage }
  interaction "no messages"() {
    participant screen: Screen
    participant storage: Storage
  }
  interaction "one authored message"() {
    participant screen: Screen
    participant storage: Storage
    message screen -> storage.persist() as receipt
  }`);

    communications.checkInteraction("no messages");
    communications.expectStaticallyValid();
    communications.expectMessages("no messages", []);

    communications.checkInteraction("one authored message");

    communications.expectStaticallyValid();
    communications.expectMessages("one authored message", [
      { from: "screen", to: "storage", operation: "Storage.persist" },
    ]);
  });

  it("retains an invalid argument alongside missing composition", () => {
    const communications = new InteractionExamples();
    communications.source(`include "./shared.expec"
  interface Storage {
    public persist
    capability persist(first: Number, second: Number) returns Nothing
  }
  interaction "two independent findings"() {
    participant storage: Storage
    message storage -> storage.persist(sharedCount, "many")
  }`);

    communications.checkInteraction("two independent findings");

    communications.expectProblem("incompatible-type", { text: '"many"' });
    communications.expectDeferred("composition", { text: "sharedCount" });
    communications.expectNoCommunication("two independent findings", 1);
  });

  it("does not trust a reply whose declared result type is unresolved", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist(count: Number) returns MissingReceipt
  }
  interaction "unknown signature"() {
    participant storage: Storage
    message storage -> storage.persist("many") as receipt
  }`);

    communications.checkInteraction("unknown signature");

    communications.expectProblem("incompatible-type", { text: '"many"' });
    communications.expectOriginalProblem("unresolved-reference", { text: "MissingReceipt" });
    communications.expectNoCommunication("unknown signature", 1);
  });

  it("checks interaction input defaults without treating result as a synthetic value", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist(count: Number) returns Nothing
  }
  interaction "ordinary input"(result: Number = 2) {
    participant storage: Storage
    message storage -> storage.persist(result)
  }
  interaction "invalid input default"(count: Number = "many") {
    participant storage: Storage
    message storage -> storage.persist(count)
  }`);

    communications.checkInteraction("ordinary input");
    communications.expectStaticallyValid();

    communications.checkInteraction("invalid input default");

    communications.expectProblem("incompatible-type", { text: '"many"' });

    communications.checkMessage("invalid input default", 1);
    communications.expectStaticallyValid();
    communications.expectMessageOperation("invalid input default", 1, "Storage.persist");
  });

  it("can read a valid message without first accepting the entire interaction", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist(count: Number) returns Nothing
  }
  interaction "one bad message"() {
    participant storage: Storage
    message storage -> storage.persist(1)
    message storage -> storage.persist("many")
  }`);

    communications.checkMessage("one bad message", 1);

    communications.expectStaticallyValid();
    communications.expectMessageOperation("one bad message", 1, "Storage.persist");

    communications.checkInteraction("one bad message");

    communications.expectProblem("incompatible-type", { text: '"many"' });
  });

  it("keeps input and earlier answers unchanged when queries run in a different order", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist, confirm
    capability persist() returns Text
    capability confirm(receipt: Text) returns Nothing
  }
  interaction "stable answers"() {
    participant storage: Storage
    message storage -> storage.persist() as receipt
    message storage -> storage.confirm(receipt)
  }`);
    communications.rememberInspection();

    communications.checkMessage("stable answers", 2);
    communications.expectStaticallyValid();
    communications.rememberReport("later message");
    communications.checkInteraction("stable answers");
    communications.rememberReport("whole interaction");
    communications.checkMessage("stable answers", 1);
    communications.checkMessage("stable answers", 2);

    communications.expectSameReportAs("later message");
    communications.expectRememberedReportUnchanged("whole interaction");
    communications.expectInspectionUnchanged();
  });

  it("rejects checking a capability as if it were an interaction", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist() returns Nothing
  }`);

    communications.attemptToCheckDeclaration("Storage.persist");

    communications.expectQueryError("unexpected-kind");
  });

  it("rejects a message handle from a different snapshot", () => {
    const communications = new InteractionExamples();
    communications.source(`interface Storage {
    public persist
    capability persist() returns Nothing
  }
  interaction "local"() {
    participant storage: Storage
    message storage -> storage.persist()
  }`);
    communications.otherSource(`interface Storage {
    public persist
    capability persist() returns Nothing
  }
  interaction "foreign"() {
    participant storage: Storage
    message storage -> storage.persist()
  }`);

    communications.attemptToReadOtherMessage("foreign", 1);

    communications.expectQueryError("foreign-node");
  });
});
