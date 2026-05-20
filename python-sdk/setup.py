from setuptools import setup, find_packages

setup(
    name="adomnia-sdk",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "grpcio>=1.60.0",
        "protobuf>=4.25.0",
    ],
    python_requires=">=3.12",
    description="adOmnia Python Plugin SDK",
    author="adOmnia",
)
