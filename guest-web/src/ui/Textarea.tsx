import { TextareaHTMLAttributes } from 'react';

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      {...props}
    />
  );
}
