"use client";
import { useEffect, useState } from "react";

/** Admin token, remembered in this browser only so it is typed once. */
export function useToken(): [string, (v: string) => void] {
  const [token, setTok] = useState("");
  useEffect(() => { try { setTok(localStorage.getItem("scout-admin-token") ?? ""); } catch { /* storage blocked */ } }, []);
  const set = (v: string) => { setTok(v); try { localStorage.setItem("scout-admin-token", v); } catch { /* ignore */ } };
  return [token, set];
}
