"""Application-level errors for bundle validation and publication."""


class BundleImportError(RuntimeError):
    """A reviewed bundle could not be safely published."""