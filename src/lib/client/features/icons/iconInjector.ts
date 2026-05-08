/**
 * Inject AWS icons into Mermaid SVG after rendering.
 *
 * Walks every <text> node in the rendered SVG, and if its content matches a
 * known AWS service name (s3, lambda, ec2, …) inserts an <image> element
 * loading the matching SVG from /icons/aws-*.svg.
 */
export const injectAWSIcons = (svgElement: SVGSVGElement): void => {
  try {
    const textNodes = svgElement.querySelectorAll('text');

    const iconMap: Record<string, string> = {
      ec2: '/icons/aws-ec2.svg',
      lambda: '/icons/aws-lambda.svg',
      s3: '/icons/aws-s3.svg',
      rds: '/icons/aws-rds.svg',
      cloudfront: '/icons/aws-cloudfront.svg',
      elb: '/icons/aws-elastic-load-balancing.svg',
      iam: '/icons/aws-iam-identity-center.svg',
      vpc: '/icons/aws-vpc.svg',
      route53: '/icons/aws-route-53.svg',
      'api gateway': '/icons/aws-api-gateway.svg'
    };

    textNodes.forEach((node) => {
      const text = node.textContent?.toLowerCase() || '';
      for (const [service, iconUrl] of Object.entries(iconMap)) {
        if (text.includes(service)) {
          const parent = node.parentElement;
          if (parent) {
            const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            img.setAttribute('href', iconUrl);
            img.setAttribute('width', '40');
            img.setAttribute('height', '40');
            img.setAttribute('x', '-20');
            img.setAttribute('y', '-20');
            parent.insertBefore(img, node);
            node.setAttribute('y', '30');
            node.setAttribute('text-anchor', 'middle');
            break;
          }
        }
      }
    });
  } catch (error) {
    console.warn('Failed to inject AWS icons:', error);
  }
};
