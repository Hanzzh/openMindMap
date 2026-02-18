/**
 * Encryption utility for securing sensitive data
 * Uses Web Crypto API with AES-GCM (256-bit keys)
 */

export class EncryptionUtil {
	private static keyPromise: Promise<CryptoKey> | null = null;
	private static deviceInfo: string = '';

	/**
	 * Initialize the encryption utility with device information
	 * This should be called once during plugin initialization
	 */
	static initialize(deviceInfo: string): void {
		this.deviceInfo = deviceInfo;
	}

	/**
	 * Generate a consistent encryption key based on device info
	 * This ensures the same key is generated on the same device
	 */
	private static async generateKey(): Promise<CryptoKey> {
		if (this.keyPromise !== null) {
			return this.keyPromise;
		}

		// Create a stable key from device-specific info
		// In production, you might want to use a user-provided password
		const keyMaterial = await crypto.subtle.importKey(
			'raw',
			this.getKeyMaterial() as unknown as ArrayBuffer,
			{ name: 'PBKDF2' },
			false,
			['deriveKey']
		);

		// Derive an AES-GCM key
		this.keyPromise = crypto.subtle.deriveKey(
			{
				name: 'PBKDF2',
				salt: this.getSalt() as BufferSource,
				iterations: 100000,
				hash: 'SHA-256'
			},
			keyMaterial,
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt']
		);

		return this.keyPromise;
	}

	/**
	 * Get key material from device/plugin identifier
	 */
	private static getKeyMaterial(): Uint8Array {
		// Use provided device info or fallback to browser API
		// eslint-disable-next-line deprecation/deprecation
		const fallbackInfo = `obsidian-mindmap-plugin-${navigator.userAgent}-${navigator.language}`;
		const identifier = this.deviceInfo || fallbackInfo;
		return new TextEncoder().encode(identifier);
	}

	/**
	 * Get salt for key derivation
	 * Fixed salt ensures consistent key generation on same device
	 */
	private static getSalt(): Uint8Array {
		const saltString = 'mindmap-plugin-salt-2024';
		return new TextEncoder().encode(saltString);
	}

	/**
	 * Encrypt text using AES-GCM
	 * @param text Plain text to encrypt
	 * @returns Base64 encoded encrypted data (IV + ciphertext)
	 */
	static async encrypt(text: string): Promise<string> {
		if (!text) return '';

		try {
			const key = await this.generateKey();

			// Generate a random IV (Initialization Vector)
			const iv = crypto.getRandomValues(new Uint8Array(12));

			// Encrypt the data
			const encodedText = new TextEncoder().encode(text);
			const encryptedData = await crypto.subtle.encrypt(
				{
					name: 'AES-GCM',
					iv: iv
				},
				key,
				encodedText
			);

			// Combine IV and encrypted data
			const combined = new Uint8Array(iv.length + encryptedData.byteLength);
			combined.set(iv);
			combined.set(new Uint8Array(encryptedData), iv.length);

			// Return as base64
			return this.arrayBufferToBase64(combined);
		} catch (error) {
			throw new Error('Failed to encrypt data');
		}
	}

	/**
	 * Decrypt encrypted text
	 * @param encryptedData Base64 encoded encrypted data (IV + ciphertext)
	 * @returns Decrypted plain text
	 */
	static async decrypt(encryptedData: string): Promise<string> {
		if (!encryptedData) return '';

		try {
			const key = await this.generateKey();

			// Decode from base64
			const combined = this.base64ToArrayBuffer(encryptedData);

			// Extract IV (first 12 bytes)
			const iv = combined.slice(0, 12);

			// Extract encrypted data (remaining bytes)
			const data = combined.slice(12);

			// Decrypt the data
			const decryptedData = await crypto.subtle.decrypt(
				{
					name: 'AES-GCM',
					iv: iv
				},
				key,
				data
			);

			// Decode to string
			return new TextDecoder().decode(decryptedData);
		} catch (error) {
			// Decryption should not fail silently - throw error to indicate problem
			console.error('Failed to decrypt API key:', error);
			throw new Error('Failed to decrypt API key. Please re-enter your API key in settings.');
		}
	}

	/**
	 * Convert ArrayBuffer to Base64
	 */
	private static arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
		const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	/**
	 * Convert Base64 to ArrayBuffer
	 */
	private static base64ToArrayBuffer(base64: string): Uint8Array {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}

	/**
	 * Check if a string is encrypted (heuristic check)
	 * Encrypted data will be longer and contain base64 characters
	 */
	static isEncrypted(text: string): boolean {
		if (!text) return false;
		// Check if it looks like base64 (alphanumeric + / + =)
		const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
		// Encrypted data should be longer than typical API key
		return text.length > 50 && base64Pattern.test(text);
	}
}
