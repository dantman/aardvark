import { AvBaseNode, AvBaseNodeProps } from './aardvark_base_node';
import { AvNodeType } from './aardvark_protocol';

interface AvOriginProps extends AvBaseNodeProps
{
	path: string;
}

export class AvOrigin extends AvBaseNode< AvOriginProps, {} >
{
	public buildNode()
	{
		let node = this.createNodeObject( AvNodeType.Origin, this.m_nodeId );
		node.propOrigin = this.props.path;
		return node;
	}
}