import { FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export function InviteForm() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("radiologist");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await api.post("/admin/invite", { email, role });
    setMessage(`Invite sent to ${email}`);
    setEmail("");
    await queryClient.invalidateQueries({ queryKey: ["users"] });
  }

  return (
    <form className="space-y-3 rounded border p-3" onSubmit={submit}>
      <h4 className="font-medium">Invite user</h4>
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="user@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <select className="w-full rounded border px-3 py-2" value={role} onChange={(event) => setRole(event.target.value)}>
        <option value="radiologist">Radiologist</option>
        <option value="radiographer">Radiographer</option>
        <option value="receptionist">Receptionist</option>
        <option value="billing">Billing</option>
        <option value="referring">Referring Physician</option>
      </select>
      <button className="rounded bg-tdai-accent px-3 py-2 text-white" type="submit">
        Send invite
      </button>
      {message ? <p className="text-sm text-green-700">{message}</p> : null}
    </form>
  );
}
