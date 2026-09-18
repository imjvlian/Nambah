-- Nambah Order Status v2: Add timing columns for countdown and terminal tracking
-- Migration adds expires_at, status_changed_at, and terminal_at columns to orders table

-- Add expires_at: Snap token expiry (30 minutes after order creation)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Add status_changed_at: Track when orders.status last changed
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

-- Add terminal_at: Track when order reaches terminal status (failed/refunded/cancelled/success)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS terminal_at timestamptz;

-- Index for expiry sweeps (helps with cleanup of expired pending_payment orders)
CREATE INDEX IF NOT EXISTS idx_orders_expires_at ON public.orders (expires_at)
  WHERE status = 'pending_payment';

-- Index for faster terminal status queries
CREATE INDEX IF NOT EXISTS idx_orders_terminal_at ON public.orders (terminal_at)
  WHERE terminal_at IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.orders.expires_at IS 'Order expires at (30 minutes after creation, matching Midtrans Snap expiry)';
COMMENT ON COLUMN public.orders.status_changed_at IS 'Timestamp when orders.status last changed';
COMMENT ON COLUMN public.orders.terminal_at IS 'Timestamp when order reaches terminal status (failed/refunded/cancelled/success)';