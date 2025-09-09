import { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl shadow p-4 bg-white ${className}`}>{children}</div>;
}

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 ${className}`} {...props} />
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`px-3 py-2 rounded-xl border border-slate-300 w-full focus:outline-none focus:ring focus:ring-blue-200 ${className}`} {...props} />
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) { return <label className={`text-sm text-slate-600 font-medium ${className}`}>{children}</label>; }
