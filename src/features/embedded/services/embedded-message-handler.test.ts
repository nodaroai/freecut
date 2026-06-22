import { describe, it, expect } from "vitest"
import { isAllowedOrigin } from "./embedded-message-handler"

describe("isAllowedOrigin", () => {
  it("allows studio.nodaro.ai, app/next, localhost and railway; rejects others", () => {
    expect(isAllowedOrigin("https://studio.nodaro.ai")).toBe(true)
    expect(isAllowedOrigin("https://app.nodaro.ai")).toBe(true)
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true)
    expect(isAllowedOrigin("https://foo.up.railway.app")).toBe(true)
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false)
  })
})
