let path = require( 'path' );

module.exports =
{
	styleguideDir: path.resolve( __dirname, "../../docs/aardvark-react" ),
	components: 
	[
		'src/*.tsx',
		'src/docs/*.tsx'
	],
	ignore: 
	[ 
		'src/aardvark_base_node.tsx'
	],
	propsParser: require('react-docgen-typescript').withDefaultConfig({}).parse,
	getComponentPathLine(componentPath) 
	{
		return undefined; // These can't work because this function doesn't get the component name
	},
	usageMode: "expand",
	webpackConfig: {
		module: 
		{
			rules:
			[
				{ 
					test: /\.tsx?$/,
					use: 'ts-loader',
					exclude: /node_modules/
				},
				{
					test: /\.css$/,
					use: 
					[
						'style-loader',
						'css-loader'
					]
				},
		]
		},
	}
	
}