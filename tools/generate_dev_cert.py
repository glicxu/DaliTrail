"""
Generate a self-signed certificate and private key for local HTTPS testing.

Usage:
    python tools/generate_dev_cert.py <cert_path> <key_path> [--overwrite]
"""

from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cert_path", type=Path, help="Where to write the certificate (PEM).")
    parser.add_argument("key_path", type=Path, help="Where to write the private key (PEM).")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing files instead of aborting.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    cert_path: Path = args.cert_path
    key_path: Path = args.key_path

    if not args.overwrite:
        for path in (cert_path, key_path):
            if path.exists():
                parser.error(f"{path} already exists. Re-run with --overwrite to replace it.")

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
            x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Local"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "DaliTrail"),
            x509.NameAttribute(NameOID.COMMON_NAME, "dalitrail.local"),
        ]
    )

    valid_from = dt.datetime.utcnow() - dt.timedelta(days=1)
    valid_to = valid_from + dt.timedelta(days=365)

    builder = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(valid_from)
        .not_valid_after(valid_to)
        .add_extension(
            x509.SubjectAlternativeName(
                [
                    x509.DNSName("localhost"),
                    x509.DNSName("dalitrail.local"),
                ]
            ),
            critical=False,
        )
        .add_extension(
            x509.BasicConstraints(ca=False, path_length=None),
            critical=True,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_encipherment=True,
                content_commitment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
    )

    certificate = builder.sign(private_key=key, algorithm=hashes.SHA256())

    cert_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.parent.mkdir(parents=True, exist_ok=True)

    cert_bytes = certificate.public_bytes(serialization.Encoding.PEM)
    key_bytes = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    cert_path.write_bytes(cert_bytes)
    key_path.write_bytes(key_bytes)

    print(f"Wrote certificate to {cert_path}")
    print(f"Wrote key to {key_path}")


if __name__ == "__main__":
    main()
