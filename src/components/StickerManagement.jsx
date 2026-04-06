import { useState } from 'react';
import { usePopup } from './PopupContext';
import axios from 'axios';
import { encryptDES } from '../utils/desCrypto';

/**
 * StickerManagement Component
 * 
 * Handles the complete parking sticker application workflow:
 * 1. Application Form: user submits plate number, vehicle type, and selects payment method
 * 2. Payment Modal: user provides payment proof reference (e.g., GCash/BDO receipt number)
 * 3. API Submission: encrypt sensitive data (plate, owner name) and POST to backend
 * 4. Records Table: display all of user's past/current applications with pagination
 * 
 * Security: Plate numbers and owner names are encrypted using DES before transmission.
 * Why encrypt? If backend or network is compromised, attacker sees garbled text, not actual plates.
 * 
 * Props:
 *   - user: current logged-in user object (contains .username)
 *   - records: array of user's sticker applications (from backend)
 *   - paymentMethods: array of available payment options (e.g., [\"GCash\", \"BDO\", \"Remittance\"])
 *   - displayFullName: user's full name (read-only in form, used for encryption)
 *   - decryptData: function to decrypt plate numbers for display
 *   - fetchUserRecords: function to refresh the records table after submission
 */
export default function StickerManagement({
    user,
    records,
    paymentMethods,
    displayFullName,
    decryptData,
    fetchUserRecords
}) {
    const { showError, showSuccess } = usePopup();

    // ============ APPLICATION FORM STATE ============
    // Step 1 of the sticker application flow
    const [plate, setPlate] = useState(''); // Plate number entered by user (e.g., \"ABC1234\")
    const [type, setType] = useState('4-Wheels'); // Vehicle type dropdown: \"2-Wheels\" | \"4-Wheels\" | \"Service\"

    // ============ PAYMENT MODAL STATE ============
    // Step 2 of the sticker application flow
    const [showPaymentModal, setShowPaymentModal] = useState(false); // Toggle: show/hide the payment modal?
    const [paymentMethod, setPaymentMethod] = useState('GCash'); // Selected payment method (GCash, BDO, etc.)
    const [paymentReference, setPaymentReference] = useState(''); // User's proof of payment (e.g., reference number, receipt #)

    // ============ TABLE PAGINATION STATE ============
    // Tracks which page of records the user is viewing
    const [applicationRecordsPage, setApplicationRecordsPage] = useState(1);

    // ============ PAGINATION CONFIGURATION ============
    // Number of records shown per page (keeps table manageable)
    const USER_RECORDS_PAGE_SIZE = 10;

    // ============ FEATURE: KEYBOARD SHORTCUT FOR FORM SUBMISSION ============
    // UX improvement: pressing Enter in plate input same as clicking \"Proceed to Payment\"
    // e.key === 'Enter' detects the Return key press in the input field
    const handleApplicationKeyPress = (e) => {
        if (e.key === 'Enter') {
            handleProceedToPayment(e); // Trigger the form submission flow
        }
    };

    // ============ FUNCTION: VALIDATE & OPEN PAYMENT MODAL ============
    // Step 1: User clicking \"Proceed to Payment\" button → this handler executes
    // Purpose: quick validation before showing payment modal
    // e.preventDefault() blocks the browser's default form reload behavior
    const handleProceedToPayment = (e) => {
        e.preventDefault();
        // Guard clause: plate is required before proceeding
        if (!plate.trim()) {
            showError('Please enter Plate Number before proceeding to payment.');
            return;
        }
        // If valid, show the payment modal overlay
        setShowPaymentModal(true);
    };

    /**
     * ============ FUNCTION: SUBMIT STICKER APPLICATION TO BACKEND ============
     * Step 2: User fills payment modal and clicks \"Submit Application\"
     * 
     * SECURITY CRITICAL: This function encrypts sensitive data (plate, owner name)
     * before sending them to the backend API.
     * 
     * Why encrypt?
     * - If someone intercepts network traffic (MITM attack), they see encrypted garbage, not actual data
     * - Even if backend database is stolen, attacker can't read the plates without the decryption key
     * - Key is stored in codebase, so attacker needs to reverse-engineer or compromise source code
     * 
     * Flow:
     * 1) Validate all required fields (plate, payment method, proof of payment)
     * 2) Encrypt sensitive fields: plate, displayFullName (owner)
     * 3) POST encrypted payload + unencrypted metadata (vehicle type, payment method) to API
     * 4) On success: reset form, close modal, refresh table to show new application
     * 5) On error: show error message (backend returned failure or network error)
     */
    const submitApp = async () => {
        // ============ VALIDATION PHASE ============
        // Check all required fields before attempting encryption/network call
        // Early return pattern: fail fast with user feedback, avoiding wasted computation
        if (!plate) return showError("Please enter Plate Number.");
        if (!paymentMethod) return showError("Please select payment method.");
        if (!paymentReference.trim()) return showError("Please enter payment reference number.");

        // ============ ENCRYPTION PHASE ============
        // Encrypt sensitive data using DES algorithm (from desCrypto.js utility)
        // encryptDES uses a hardcoded key shared between frontend and backend
        const encPlate = encryptDES(plate); // Example: \"ABC1234\" → \"$sDf#1@8\"
        const encOwner = encryptDES(displayFullName); // Example: \"John Doe\" → \"kX9$mL2#\"
        
        try {
            // ============ SUBMISSION PHASE ============
            // POST to backend with encrypted plate and owner, plus other metadata
            // Backend will: 1) Store encrypted values in database,  2) Auto-decrypt using same key for display
            await axios.post('http://127.0.0.1:8000/api/submit-vehicle/', {
                username: user.username, // Current user's username (not encrypted, used to link application to user)
                ownerName: encOwner, // ENCRYPTED full name of vehicle owner
                plateNumber: encPlate, // ENCRYPTED vehicle plate number
                vehicleType: type, // Not encrypted: \"2-Wheels\", \"4-Wheels\", or \"Service\"
                paymentMethod, // Not encrypted: \"GCash\", \"BDO\", etc.
                paymentReference: paymentReference.trim() // Not encrypted: reference number from payment proof
            });

            // ============ SUCCESS HANDLING ============
            // Application saved! Reset UI and notify user
            showSuccess("Application Sent!");
            setPlate(''); // Clear plate input
            setPaymentMethod('GCash'); // Reset to default payment method
            setPaymentReference(''); // Clear reference input
            setShowPaymentModal(false); // Close payment modal

            // Refresh the records table immediately so user sees their new application
            // This triggers fetchUserRecords in parent, which fetches latest records from backend
            fetchUserRecords(user.username);
        } catch (err) {
            // ============ ERROR HANDLING ============
            // Backend error (400, 409, 500, etc.) or network failure
            // Prefer backend's error message if provided, otherwise generic fallback
            showError(err?.response?.data?.message || "Submission failed.");
        }
    };

    // FEATURE (Records Table): show the newest records first without mutating the original array.
    const orderedUserApplicationRecords = records.slice().reverse();

    // FEATURE (Pagination): compute total pages and clamp the current page.
    // Math.max(1, ...) ensures the UI still has Page 1 even when there are no records.
    const userApplicationTotalPages = Math.max(1, Math.ceil(orderedUserApplicationRecords.length / USER_RECORDS_PAGE_SIZE));
    const safeApplicationRecordsPage = Math.min(applicationRecordsPage, userApplicationTotalPages);

    // Only these rows are displayed on the current page.
    const paginatedUserApplicationRecords = orderedUserApplicationRecords.slice(
        (safeApplicationRecordsPage - 1) * USER_RECORDS_PAGE_SIZE,
        (safeApplicationRecordsPage - 1) * USER_RECORDS_PAGE_SIZE + USER_RECORDS_PAGE_SIZE
    );

    return (
        <>
            {/* FEATURE A: Sticker application form */}
            {/* Step A1: user enters the plate and vehicle type */}
            {/* Step A2: user clicks Proceed to Payment */}
            <div className="panel">
                <h3 className="panel-title">Apply for Parking Sticker</h3>
                <form onSubmit={handleProceedToPayment}>
                    <div className="form-row-single">
                        <div className="auto-field">
                            <label className="small-label">Registered Owner</label>
                            <input type="text" value={displayFullName} disabled className="disabled-input" />
                        </div>
                        <div className="input-field">
                            <label className="small-label">Plate Number</label>
                            <input 
                                placeholder="Enter Plate Number" 
                                value={plate} 
                                onChange={e => setPlate(e.target.value)}
                                onKeyDown={handleApplicationKeyPress}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '10px' }}>
                        <div>
                            <label className="small-label">Vehicle Type</label>
                            <select value={type} onChange={e => setType(e.target.value)} style={{ margin: '7px 0' }}>
                                <option value="2-Wheels">2-Wheels (₱1,000)</option>
                                <option value="4-Wheels">4-Wheels (₱2,000)</option>
                                <option value="Service">Service (₱3,000)</option>
                            </select>
                        </div>
                    </div>

                    <button type="submit" className="btn-purple submit-btn" style={{ width: '100%', marginTop: '15px' }}>
                        Proceed to Payment
                    </button>
                </form>
            </div>

            {/* FEATURE B: Application records table */}
            {/* Step B1: get the records for the current page */}
            {/* Step B2: decrypt the stored plate_number before displaying it */}
            <div className="panel">
                <h3 className="panel-title">My Application Records</h3>
                <div className="table-wrap">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Plate Number</th>
                                <th>Type</th>
                                <th>Payment Method</th>
                                <th>Reference No.</th>
                                <th>Status</th>
                                <th>Sticker ID</th>
                                <th>Expires</th>
                            </tr>
                        </thead>
                        <tbody>
                            {records.length === 0 ? (
                                <tr><td colSpan="7" className="empty-table">No records found.</td></tr>
                            ) : (
                                paginatedUserApplicationRecords.map((v, i) => (
                                    <tr key={i}>
                                        {/* The plate is stored encrypted in the backend,
                                            so we decrypt it here to show a readable value to the user. */}
                                        <td className="bold-plate">{decryptData(v.plate_number)}</td>
                                        <td>{v.vehicle_type}</td>
                                        <td>{v.payment_method || '---'}</td>
                                        <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{v.payment_reference || '---'}</td>
                                        <td>
                                            <span className={`status-badge ${v.status.toLowerCase()}`}>
                                                {v.status}
                                            </span>
                                        </td>
                                        <td className="sticker-id">{v.sticker_id || '---'}</td>
                                        <td>
                                            {/* Color rule: red means expired, green means still valid. */}
                                            {v.expiration_date ? (
                                                <span style={{ 
                                                    color: new Date(v.expiration_date) < new Date() ? '#dc2626' : '#16a34a',
                                                    fontWeight: 'bold'
                                                }}>
                                                    {new Date(v.expiration_date).toLocaleDateString()}
                                                </span>
                                            ) : '---'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {orderedUserApplicationRecords.length > USER_RECORDS_PAGE_SIZE && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                        <button
                            className="btn-gray slim"
                            onClick={() => setApplicationRecordsPage((prev) => Math.max(1, prev - 1))}
                            disabled={safeApplicationRecordsPage === 1}
                            style={{ marginTop: 0, opacity: safeApplicationRecordsPage === 1 ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                        >
                            Prev
                        </button>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#334155', minWidth: '90px', textAlign: 'center' }}>
                            Page {safeApplicationRecordsPage} of {userApplicationTotalPages}
                        </span>
                        <button
                            className="btn-gray slim"
                            onClick={() => setApplicationRecordsPage((prev) => Math.min(userApplicationTotalPages, prev + 1))}
                            disabled={safeApplicationRecordsPage === userApplicationTotalPages}
                            style={{ marginTop: 0, opacity: safeApplicationRecordsPage === userApplicationTotalPages ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                        >
                            Next
                        </button>
                    </div>
                )}
            </div>

            {/* FEATURE C: Payment modal */}
            {/* Step C1: choose a payment method and enter the reference number */}
            {/* Step C2: click Confirm Payment to run submitApp() */}
            {showPaymentModal && (
                <div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
                    <div className="modal-content card" style={{ maxWidth: '560px', width: '94%', color: '#ffffff' }} onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ marginTop: 0, color: '#ffffff' }}>Sticker Payment</h3>
                        <p style={{ marginBottom: '12px', color: '#ffffff' }}>
                            List of Payment Method:{' '}
                            <a
                                href="https://bit.ly/ListOfPaymentMethod"
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: '#93c5fd' }}
                            >
                                https://bit.ly/ListOfPaymentMethod
                            </a>
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div>
                                    <label className="small-label" style={{ color: '#ffffff' }}>Payment Method</label>
                                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                                        {paymentMethods.map(method => (
                                            <option key={method} value={method}>{method}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="small-label" style={{ color: '#ffffff' }}>Reference Number</label>
                                    <input
                                        type="text"
                                        placeholder="Enter payment reference number"
                                        value={paymentReference}
                                        onChange={(e) => setPaymentReference(e.target.value)}
                                    />
                                </div>
                                <div style={{ padding: '10px', borderRadius: '8px', background: '#1e3a8a', color: '#ffffff', fontSize: '13px' }}>
                                    Fee: {type === '2-Wheels' ? 'Php 1,000' : type === '4-Wheels' ? 'Php 2,000' : 'Php 3,000'}
                                </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
                            <button className="btn-gray" style={{ width: '110px', flexShrink: 0 }} onClick={() => setShowPaymentModal(false)}>Back</button>
                            <button className="btn-green" style={{ flex: 1 }} onClick={submitApp}>Confirm Payment</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}