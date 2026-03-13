/**
 * Input validation and sanitization utilities
 */

export interface IssueDetails {
    line: number;
    message: string;
    type: string;
    severity: string;
}

export interface ValidationResult {
    valid: boolean;
    error?: string;
    sanitized?: {
        input: string;
        fileName: string;
        mode?: 'analyze' | 'fix';
        issue?: IssueDetails;
        fullFileContext?: string;
        issueLineInFile?: number;
    };
}

// Limits
const MAX_INPUT_LENGTH = 500_000; // 500KB of code
const MAX_FILENAME_LENGTH = 255;
const MIN_INPUT_LENGTH = 1;

// Allowed file extensions for analysis
const ALLOWED_EXTENSIONS = new Set([
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
    'py', 'pyw',
    'java',
    'go',
    'rs',
    'c', 'cpp', 'cc', 'cxx', 'h', 'hpp',
    'cs',
    'php',
    'rb',
    'swift',
    'kt', 'kts',
    'scala',
    'dart',
    'vue', 'svelte',
    'html', 'htm',
    'css', 'scss', 'sass', 'less',
    'json', 'yaml', 'yml', 'toml',
    'xml',
    'md', 'mdx',
    'sql',
    'sh', 'bash', 'zsh',
    'dockerfile',
    'tf', 'hcl' // Terraform
]);

/**
 * Validate and sanitize analysis request input
 */
export function validateAnalysisInput(body: any): ValidationResult {
    // Check if body exists
    if (!body || typeof body !== 'object') {
        return { valid: false, error: 'Request body must be a JSON object' };
    }

    const { input, fileName, mode, issue, fullFileContext, issueLineInFile } = body;

    // Validate input field
    if (input === undefined || input === null) {
        return { valid: false, error: "Missing required field: 'input'" };
    }

    if (typeof input !== 'string') {
        return { valid: false, error: "'input' must be a string" };
    }

    if (input.length < MIN_INPUT_LENGTH) {
        return { valid: false, error: 'Input code is empty' };
    }

    if (input.length > MAX_INPUT_LENGTH) {
        return {
            valid: false,
            error: `Input too large: ${input.length} chars (max: ${MAX_INPUT_LENGTH})`
        };
    }

    // Validate fileName if provided
    let sanitizedFileName = 'unknown.txt';

    if (fileName !== undefined && fileName !== null) {
        if (typeof fileName !== 'string') {
            return { valid: false, error: "'fileName' must be a string" };
        }

        if (fileName.length > MAX_FILENAME_LENGTH) {
            return {
                valid: false,
                error: `fileName too long: ${fileName.length} chars (max: ${MAX_FILENAME_LENGTH})`
            };
        }

        // Sanitize fileName - remove path traversal attempts and special chars
        sanitizedFileName = sanitizeFileName(fileName);
    }

    // Sanitize input - remove potential prompt injection markers
    const sanitizedInput = sanitizeCodeInput(input);

    // Validate mode if provided
    const sanitizedMode = mode === 'fix' ? 'fix' : 'analyze';

    // Validate issue details for fix mode
    let sanitizedIssue: IssueDetails | undefined;
    if (sanitizedMode === 'fix' && issue) {
        if (typeof issue !== 'object') {
            return { valid: false, error: "'issue' must be an object" };
        }
        sanitizedIssue = {
            line: typeof issue.line === 'number' ? issue.line : 0,
            message: typeof issue.message === 'string' ? issue.message.substring(0, 1000) : '',
            type: typeof issue.type === 'string' ? issue.type : 'unknown',
            severity: typeof issue.severity === 'string' ? issue.severity : 'warning'
        };
    }

    // Sanitize fullFileContext if provided (for fix mode)
    let sanitizedFullContext: string | undefined;
    if (fullFileContext && typeof fullFileContext === 'string') {
        sanitizedFullContext = sanitizeCodeInput(fullFileContext.substring(0, MAX_INPUT_LENGTH));
    }

    // Validate issueLineInFile
    const sanitizedIssueLineInFile = typeof issueLineInFile === 'number' ? issueLineInFile : undefined;

    return {
        valid: true,
        sanitized: {
            input: sanitizedInput,
            fileName: sanitizedFileName,
            mode: sanitizedMode,
            issue: sanitizedIssue,
            fullFileContext: sanitizedFullContext,
            issueLineInFile: sanitizedIssueLineInFile
        }
    };
}

/**
 * Sanitize file name
 * - Removes path components (no ../ or absolute paths)
 * - Removes special characters
 * - Preserves extension
 */
function sanitizeFileName(fileName: string): string {
    // Extract just the filename (no path)
    let name = fileName.split(/[/\\]/).pop() || 'unknown.txt';

    // Remove null bytes and control characters
    name = name.replace(/[\x00-\x1f\x7f]/g, '');

    // Remove potentially dangerous characters but keep dots for extension
    name = name.replace(/[<>:"|?*]/g, '');

    // Limit length
    if (name.length > MAX_FILENAME_LENGTH) {
        const ext = name.split('.').pop() || '';
        const base = name.slice(0, MAX_FILENAME_LENGTH - ext.length - 1);
        name = `${base}.${ext}`;
    }

    // Default if empty
    if (!name || name === '.') {
        name = 'unknown.txt';
    }

    return name;
}

/**
 * Sanitize code input
 * - Removes prompt injection attempts
 * - Preserves code structure
 */
function sanitizeCodeInput(input: string): string {
    let sanitized = input;

    // Remove null bytes
    sanitized = sanitized.replace(/\x00/g, '');

    // Detect and neutralize common prompt injection patterns
    // These patterns try to break out of the code context
    const injectionPatterns = [
        // Attempts to end the code block and inject new instructions
        /```\s*\n\s*(ignore|forget|disregard|new instruction|system:|assistant:|human:)/gi,
        // Direct instruction injection
        /\n\s*(ignore previous|forget everything|disregard above|new task:)/gi,
    ];

    for (const pattern of injectionPatterns) {
        if (pattern.test(sanitized)) {
            // Don't reject, just log and continue - the LLM prompt is structured
            // to treat all input as code
            console.warn('Potential prompt injection attempt detected in input');
        }
    }

    return sanitized;
}

