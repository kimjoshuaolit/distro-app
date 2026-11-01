import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetCamera, rememberCamera, rememberedCamera } from './cameraMemory.ts'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

function throwingStorage() {
  const fail = () => {
    throw new Error('storage blocked')
  }
  return { getItem: fail, setItem: fail, removeItem: fail }
}

describe('cameraMemory', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('remembers nothing until the camera has been on', () => {
    expect(rememberedCamera()).toBeNull()
  })

  it('remembers the lens the guest was using', () => {
    rememberCamera('user')
    expect(rememberedCamera()).toBe('user')
    rememberCamera('environment')
    expect(rememberedCamera()).toBe('environment')
  })

  it('forgets, so a refused camera shows the turn-on screen again', () => {
    rememberCamera('environment')
    forgetCamera()
    expect(rememberedCamera()).toBeNull()
  })

  it('ignores a value it did not write', () => {
    localStorage.setItem('drc:camera', 'sideways')
    expect(rememberedCamera()).toBeNull()
  })

  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', throwingStorage())
    expect(() => rememberCamera('user')).not.toThrow()
    expect(() => forgetCamera()).not.toThrow()
    expect(rememberedCamera()).toBeNull()
  })
})
