import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';
export function Button({ className, variant: _variant, size: _size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) {
  return <button className={cn('chat-icon-button', className)} {...props} />;
}
