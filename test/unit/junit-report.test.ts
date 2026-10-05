import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { junitReport } from '../../src/junit-report.js';

const nativeReport = (name: string) => readFile(new URL('../resources/junit-reports/'+name+'.xml',import.meta.url),'utf8');
const selected = (name: string, methodName='selected') => ({id:'case-'+name,file:'Probe.java',title:'selected()',className:'Probe$'+name,methodName,parameters:[]});
const notVerified = {code:'generated-tests-not-executed'};
const invalid = {code:'invalid-native-report'};

describe('native JUnit execution observations', () => {
  it('recognizes only the actual selected native method', async () => {
    const report=junitReport(await nativeReport('Exact'),[selected('Exact')]);
    expect(report.tests).toEqual([{id:'case-Exact',file:'Probe.java',title:'selected()',state:'passed',errors:[]}]);
    expect(report.errors).toEqual([]); expect(report.problems).toEqual([]);
  });
  it('does not turn a disabled method into a pass', async () => {
    const report=junitReport(await nativeReport('Disabled'),[selected('Disabled')]);
    expect(report.tests[0]).toMatchObject({state:'skipped',errors:['human pending']});
    expect(report.problems).toContainEqual(expect.objectContaining(notVerified));
  });
  it('retains native assumption aborts', async () => {
    const report=junitReport(await nativeReport('Aborted'),[selected('Aborted')]);
    expect(report.tests[0]).toMatchObject({state:'aborted'});
    expect(report.tests[0]!.errors.join('\n')).toContain('application unavailable');
  });
  it('reports setup failure and the missing selected method', async () => {
    const report=junitReport(await nativeReport('Setup'),[selected('Setup')]);
    expect(report.tests).toEqual([]); expect(report.errors.join('\n')).toContain('setup failed');
    expect(report.problems).toContainEqual(expect.objectContaining(notVerified));
  });
  it('preserves assertion failure and suppressed cleanup failure', async () => {
    const report=junitReport(await nativeReport('Dual'),[selected('Dual')]);
    expect(report.tests[0]).toMatchObject({state:'failed'});
    expect(report.tests[0]!.errors.join('\n')).toContain('expected: <1> but was: <2>');
    expect(report.tests[0]!.errors.join('\n')).toContain('Suppressed: java.lang.IllegalStateException: cleanup failed');
  });
  it('does not invent a test for a disabled container', async () => {
    const report=junitReport(await nativeReport('DisabledClass'),[selected('DisabledClass')]);
    expect(report.tests).toEqual([]); expect(report.errors.join('\n')).toContain('class pending');
    expect(report.problems).toContainEqual(expect.objectContaining(notVerified));
  });
  it('keeps a nonexistent selected method missing', async () => {
    const report=junitReport(await nativeReport('Missing'),[selected('Exact','missing')]);
    expect(report.tests).toEqual([]); expect(report.errors.join('\n')).toContain('missing');
    expect(report.problems).toContainEqual(expect.objectContaining(notVerified));
  });
  it('does not attribute an unexpected native method to the selected case', async () => {
    const report=junitReport(await nativeReport('Exact'),[selected('Exact','another')]);
    expect(report.tests).toEqual([]);
    expect(report.problems).toContainEqual(expect.objectContaining(notVerified));
  });
  it('does not accept a partial native report with no finished events', async () => {
    const xml=(await nativeReport('Exact')).replace(/<e:finished[^>]*>.*?<\/e:finished>/gs,'');
    const report=junitReport(xml,[selected('Exact')]);
    expect(report.tests).toEqual([]); expect(report.problems).toContainEqual(expect.objectContaining(invalid));
  });
  it('rejects duplicate completion events instead of counting one case twice', async () => {
    const xml=await nativeReport('Exact'),event=xml.match(/<e:finished id="3"[^>]*>.*?<\/e:finished>/s)![0];
    const report=junitReport(xml.replace('</e:events>',event+'</e:events>'),[selected('Exact')]);
    expect(report.tests).toEqual([]); expect(report.problems).toContainEqual(expect.objectContaining(invalid));
  });
  it('rejects duplicate selected native identities', async () => {
    const report=junitReport(await nativeReport('Exact'),[selected('Exact'),{...selected('Exact'),id:'another-id'}]);
    expect(report.tests).toEqual([]); expect(report.problems).toContainEqual(expect.objectContaining(invalid));
  });
  it('does not trust a result element in an unrelated XML namespace', async () => {
    const xml=(await nativeReport('Exact')).replace('status="SUCCESSFUL"','xmlns="urn:unrelated" status="SUCCESSFUL"');
    const report=junitReport(xml,[selected('Exact')]);
    expect(report.tests).toEqual([]); expect(report.problems).toContainEqual(expect.objectContaining(invalid));
  });
  it('refuses document types without resolving their external resources', async () => {
    const xml=(await nativeReport('Exact')).replace('<e:events','<!DOCTYPE events SYSTEM "file:///never-read.dtd"><e:events');
    const report=junitReport(xml,[selected('Exact')]);
    expect(report.tests).toEqual([]); expect(report.problems).toContainEqual(expect.objectContaining(invalid));
  });
  it('does not accept mismatched event nesting', async () => {
    const xml=(await nativeReport('Exact')).replace('parentId="2"','parentId="unknown"');
    const report=junitReport(xml,[selected('Exact')]);
    expect(report.tests).toEqual([]); expect(report.problems).toContainEqual(expect.objectContaining(invalid));
  });
  it('retains the actual native title instead of echoing the requested title', async () => {
    const report=junitReport(await nativeReport('Exact'),[{...selected('Exact'),title:'Different author title'}]);
    expect(report.tests[0]?.title).toBe('selected()');
  });
  it('rejects unknown failure payloads even beside a successful result', async () => {
    const xml=(await nativeReport('Exact')).replace('<result status="SUCCESSFUL">','<result status="SUCCESSFUL"><unknown:failure xmlns:unknown="urn:untrusted">failed</unknown:failure>');
    const report=junitReport(xml,[selected('Exact')]);
    expect(report.tests).toEqual([]); expect(report.problems).toContainEqual(expect.objectContaining(invalid));
  });
  it('requires a declared native status rather than an object property name', async () => {
    const xml=(await nativeReport('Exact')).replace('status="SUCCESSFUL"','status="toString"');
    const report=junitReport(xml,[selected('Exact')]);
    expect(report.tests).toEqual([]); expect(report.problems).toContainEqual(expect.objectContaining(invalid));
  });

  it('does not accept a passing test detached from its native containers', async () => {
    let xml=await nativeReport('Exact');
    for(const id of ['1','2']) xml=xml.replace(new RegExp('<e:started id="'+id+'"[^>]*>.*?</e:started>','s'),'').replace(new RegExp('<e:finished id="'+id+'"[^>]*>.*?</e:finished>','s'),'');
    xml=xml.replace(' parentId="2"','');
    const report=junitReport(xml,[selected('Exact')]);
    expect(report.tests).toEqual([]); expect(report.problems).toContainEqual(expect.objectContaining(invalid));
  });
  it('does not accept an ordinary test as another test parent', async () => {
    let xml=await nativeReport('Exact');
    const event=xml.match(/<e:started id="2"[^>]*>.*?<\/e:started>/s)![0];
    xml=xml.replace(event,event.replace('<junit:type>CONTAINER</junit:type>','<junit:type>TEST</junit:type>').replace(/<java:classSource[^>]*><\/java:classSource>/,'<java:methodSource className="Probe$Exact" methodName="parent" methodParameterTypes=""></java:methodSource>'));
    const report=junitReport(xml,[selected('Exact')]);
    expect(report.tests).toEqual([]); expect(report.problems).toContainEqual(expect.objectContaining(invalid));
  });
  it('permits multiple actual engine containers without inventing extra selected tests', async () => {
    const report=junitReport(await nativeReport('MultipleEngines'),[selected('Exact')]);
    expect(report.tests).toEqual([{id:'case-Exact',file:'Probe.java',title:'selected()',state:'passed',errors:[]}]);
    expect(report.errors).toEqual([]); expect(report.problems).toEqual([]);
  });

});
