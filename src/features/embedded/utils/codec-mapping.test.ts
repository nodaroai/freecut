import { describe, it, expect } from 'vitest';
import { reverseMapCodec, roundToNearestAllowedFps } from './codec-mapping';

describe('reverseMapCodec', () => {
  it('maps avc to h264', () => expect(reverseMapCodec('avc')).toBe('h264'));
  it('maps hevc to h265', () => expect(reverseMapCodec('hevc')).toBe('h265'));
  it('maps vp8 to vp8', () => expect(reverseMapCodec('vp8')).toBe('vp8'));
  it('maps vp9 to vp9', () => expect(reverseMapCodec('vp9')).toBe('vp9'));
  it('falls back to h264 for unknown', () => expect(reverseMapCodec('av1')).toBe('h264'));
  it('falls back to h264 for empty', () => expect(reverseMapCodec('')).toBe('h264'));
});

describe('roundToNearestAllowedFps', () => {
  it('rounds 29.97 to 30', () => expect(roundToNearestAllowedFps(29.97)).toBe(30));
  it('rounds 23.976 to 24', () => expect(roundToNearestAllowedFps(23.976)).toBe(24));
  it('rounds 59.94 to 60', () => expect(roundToNearestAllowedFps(59.94)).toBe(60));
  it('rounds 48 to 50', () => expect(roundToNearestAllowedFps(48)).toBe(50));
  it('keeps exact 30', () => expect(roundToNearestAllowedFps(30)).toBe(30));
  it('keeps exact 24', () => expect(roundToNearestAllowedFps(24)).toBe(24));
  it('rounds 1 to 24', () => expect(roundToNearestAllowedFps(1)).toBe(24));
});
