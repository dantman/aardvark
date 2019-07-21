#pragma once

#include <string>

namespace tools
{
	std::string WStringToUtf8( const std::wstring & swString );
	std::wstring Utf8ToWString( const std::string & swString );

	std::string stringToLower( const std::string & s );
	bool stringIsPrefix( const std::string & sPrefix, const std::string & sTestString );
	bool stringIsPrefixCaseSensitive( const std::string & sPrefix, const std::string & sTestString );
}