import { useEffect } from 'react';
import './Popup.css';

/**
 * Popup Component
 *
 * Purpose:
 * Reusable notification UI used by PopupContext for user feedback messages.
 * Supports two display modes:
 * 1) Toast mode (small auto-dismiss message at edge of screen)
 * 2) Modal mode (overlay dialog requiring user acknowledgement)
 *
 * Props:
 * - message: string content shown to user
 * - type: visual variant ('success' | 'error' | 'warning' | 'info')
 * - onClose: callback to clear popup state in parent/context
 * - duration: auto-close time in ms; 0 means persistent until user closes
 *
 * Rendering rule:
 * - `type === 'info'` with `duration > 0` => toast
 * - all other cases => modal
 */
export default function Popup({ message, type = 'info', onClose, duration = 0 }) {
    // Toast is intentionally limited to timed info messages for subtle UX.
    // Errors/warnings/success usually stay modal unless caller decides otherwise.
    const isToast = type === 'info' && duration > 0;

    // Auto-close effect:
    // If duration is positive, start a timer and close popup after duration ms.
    // Cleanup prevents memory leaks and cancels previous timers if props change.
    useEffect(() => {
        if (duration > 0) {
            const timer = setTimeout(() => {
                onClose();
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [duration, onClose]);

    // Icon helper maps popup type to a small symbolic icon.
    // This icon is rendered in the close button for quick visual context.
    const getIcon = () => {
        switch (type) {
            case 'success':
                return '✓';
            case 'error':
                return '✗';
            case 'warning':
                return '⚠';
            default:
                return 'ℹ';
        }
    };

    // Maps semantic type to CSS class used for colors/borders.
    // CSS file controls visual style; component only chooses class name.
    const getTypeClass = () => {
        switch (type) {
            case 'success':
                return 'popup-success';
            case 'error':
                return 'popup-error';
            case 'warning':
                return 'popup-warning';
            default:
                return 'popup-info';
        }
    };

    if (isToast) {
        // Toast branch:
        // - no overlay
        // - compact message card
        // - closes automatically via timer in useEffect
        return (
            <div className="popup-toast-wrap">
                <div className={`popup-toast ${getTypeClass()}`}>
                    {message}
                </div>
            </div>
        );
    }

    // Modal branch:
    // - full-screen overlay catches outside clicks to close
    // - popup-content stops click bubbling so inner clicks do not close modal
    // - explicit close controls: icon close button and OK button
    return (
        <div className="popup-overlay" onClick={onClose}>
            <div className={`popup-content ${getTypeClass()}`} onClick={(e) => e.stopPropagation()}>
                <div className="popup-header">
                    {/* Close button gives users direct dismissal control */}
                    <button className="popup-close" onClick={onClose} aria-label="Close popup">{getIcon()}</button>
                </div>
                <div className="popup-message">
                    {message}
                </div>
                <div className="popup-actions">
                    {/* Primary acknowledgement action for modal messages */}
                    <button className="popup-btn" onClick={onClose}>OK</button>
                </div>
            </div>
        </div>
    );
}