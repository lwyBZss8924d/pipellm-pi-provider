import { expect, test } from 'bun:test';
import {
  classifyResponse,
  classifySize,
  promptTokens,
  retryForcedToolChoice,
  isTransientError,
} from '../src/classify';
import fixtures from './fixtures/responses.json';

test('usage includes input, cache read and cache creation; missing usage is unknown', () => {
  expect(
    promptTokens({
      input_tokens: 12,
      cache_read_input_tokens: 6000,
      cache_creation_input_tokens: 502,
    }),
  ).toBe(6514);
  expect(promptTokens({ cache_read_input_tokens: 6000 })).toBe(6000);
  expect(promptTokens({})).toBeUndefined();
  expect(promptTokens({ input_tokens: -1 })).toBeUndefined();
  expect(
    classifySize({ input_tokens: 12 }, { input_tokens: 12, cache_read_input_tokens: 6502 }),
  ).toBe('PASSTHROUGH');
  expect(classifySize({}, {})).toBe('UNKNOWN');
  expect(
    classifySize(
      { input_tokens: 4, cache_read_input_tokens: 18000 },
      { input_tokens: 4, cache_read_input_tokens: 18000 },
    ),
  ).toBe('SUBSTITUTED');
});
test('forced-choice rejection is retried as auto, account errors remain errors', () => {
  expect(retryForcedToolChoice(400, fixtures.forcedChoice)).toBe(true);
  expect(
    retryForcedToolChoice(400, {
      error: { message: 'tool_choice is not supported for this model' },
    }),
  ).toBe(true);
  expect(retryForcedToolChoice(400, fixtures.transient)).toBe(false);
  expect(retryForcedToolChoice(500, fixtures.forcedChoice)).toBe(false);
  expect(isTransientError(400, fixtures.transient)).toBe(true);
  expect(isTransientError(400, fixtures.forcedChoice)).toBe(false);
  expect(classifyResponse(400, ['canary_probe'], fixtures.transient)).toBe('ERROR');
});
test('both models use the same contract and only invented tools imply substitution', () => {
  for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5']) {
    expect(classifyResponse(200, ['canary_probe'], { ...fixtures.passthrough, model })).toBe(
      'PASSTHROUGH',
    );
    expect(classifyResponse(200, ['canary_probe'], { ...fixtures.substituted, model })).toBe(
      'SUBSTITUTED',
    );
  }
  expect(classifyResponse(200, [], {})).toBe('ERROR');
});
