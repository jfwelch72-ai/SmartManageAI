# Error Handling Standards

## HTTP Status Codes
- **200**: Success (GET, PATCH, DELETE success)
- **201**: Resource created (POST success)
- **400**: Client input validation errors
- **401**: Authentication required/failed
- **403**: Insufficient permissions (authorization failure)
- **404**: Resource not found
- **409**: Resource conflict (duplicate entries, state violations)
- **500**: Internal server error

## Response Format
All error responses use consistent JSON format:

### Standard Error (all 4xx/5xx):
```json
{
  "error": "Human-readable error message"
}
```

### Validation Error (400 with details):
```json
{
  "error": "Invalid input",
  "details": "Detailed validation error from Zod"
}
```

## Implementation Pattern
```typescript
// Authentication check
if (!req.user) {
  return res.status(401).json({ error: "Authentication required" });
}

// Authorization check
if (req.user.role !== 'ADMIN') {
  return res.status(403).json({ error: "Admin access required" });
}

// Validation error
if (!validationResult.success) {
  return res.status(400).json({ 
    error: "Invalid input", 
    details: fromZodError(validationResult.error).toString() 
  });
}

// Resource not found
if (!resource) {
  return res.status(404).json({ error: "Resource not found" });
}

// Conflict (unique violation, state machine)
if (error.code === '23505') {
  return res.status(409).json({ error: "Resource already exists" });
}

// Server error
catch (error: any) {
  console.error("Operation failed:", error);
  res.status(500).json({ error: "Internal server error" });
}
```
