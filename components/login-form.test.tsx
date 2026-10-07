import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";

vi.mock("@/lib/auth-client", () => ({
  signIn: { social: vi.fn() },
  signOut: vi.fn(),
  useSession: () => ({ data: undefined, isPending: false }),
}));

describe("LoginForm", () => {
  it("renders the pitch and the discord button", () => {
    render(<LoginForm />);

    expect(screen.getByText("3 Nice Things")).toBeInTheDocument();
    expect(screen.getByText(/log three nice things you did for yourself/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue with Discord/i })).toBeInTheDocument();
  });

  it("starts discord OAuth on click", async () => {
    const { signIn } = await import("@/lib/auth-client");
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: /Continue with Discord/i }));

    expect(signIn.social).toHaveBeenCalledWith({ provider: "discord", callbackURL: "/" });
  });
});
