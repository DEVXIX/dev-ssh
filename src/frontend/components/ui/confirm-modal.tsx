import { useEffect } from 'react';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
import { AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info' | 'success';
}

const variantConfig = {
  danger: {
    icon: XCircle,
    iconColor: 'text-destructive',
    confirmButtonVariant: 'destructive' as const,
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-yellow-500',
    confirmButtonVariant: 'default' as const,
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-500',
    confirmButtonVariant: 'default' as const,
  },
  success: {
    icon: CheckCircle,
    iconColor: 'text-green-500',
    confirmButtonVariant: 'default' as const,
  },
};

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'warning',
}: ConfirmModalProps) {
  const config = variantConfig[variant];
  const Icon = config.icon;

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-md animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full bg-muted ${config.iconColor}`}>
              <Icon className="h-6 w-6" />
            </div>
            <CardTitle className="text-lg">{title}</CardTitle>
          </div>
          {description && (
            <CardDescription className="mt-2 text-sm leading-relaxed">
              {description}
            </CardDescription>
          )}
        </CardHeader>
        <CardFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1"
          >
            {cancelText}
          </Button>
          <Button
            variant={config.confirmButtonVariant}
            onClick={handleConfirm}
            className="flex-1 border-2"
            autoFocus
          >
            {confirmText}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
