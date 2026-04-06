/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState } from 'react';
import Popup from './Popup';

// Shared popup context for app-wide notifications.
const PopupContext = createContext();

/**
 * PopupProvider
 * Wrap this around app content so children can call usePopup().
 */
export function PopupProvider({ children }) {
    // Current popup payload. null means no popup is shown.
    const [popup, setPopup] = useState(null);

    // Base setter used by specialized helpers below.
    const showPopup = (message, type = 'info', duration = 0) => {
        setPopup({ message, type, duration });
    };

    // Removes popup from UI.
    const hidePopup = () => {
        setPopup(null);
    };

    // Convenience helpers with sensible defaults.
    const showSuccess = (message, duration = 3000) => {
        showPopup(message, 'success', duration);
    };

    const showError = (message, duration = 0) => {
        showPopup(message, 'error', duration);
    };

    const showWarning = (message, duration = 0) => {
        showPopup(message, 'warning', duration);
    };

    const showInfo = (message, duration = 0) => {
        showPopup(message, 'info', duration);
    };

    return (
        <PopupContext.Provider
            value={{
                showPopup,
                showSuccess,
                showError,
                showWarning,
                showInfo,
                hidePopup
            }}
        >
            {children}
            {popup && (
                <Popup
                    message={popup.message}
                    type={popup.type}
                    onClose={hidePopup}
                    duration={popup.duration}
                />
            )}
        </PopupContext.Provider>
    );
}

/**
 * usePopup
 * Access popup controls from PopupContext.
 */
export function usePopup() {
    const context = useContext(PopupContext);
    if (!context) {
        throw new Error('usePopup must be used within a PopupProvider');
    }
    return context;
}
